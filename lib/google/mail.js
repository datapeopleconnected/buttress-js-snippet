'use strict';

/**
 * Buttress - The federated real-time open data platform
 * Copyright (C) 2016-2025 Data People Connected LTD.
 * <https://www.dpc-ltd.com/>
 *
 * This file is part of Buttress.
 * Buttress is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public Licence as published by the Free Software
 * Foundation, either version 3 of the Licence, or (at your option) any later version.
 * Buttress is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public Licence for more details.
 * You should have received a copy of the GNU Affero General Public Licence along with
 * this program. If not, see <http://www.gnu.org/licenses/>.
 */

const Helpers = require('../helpers/helpers');
const MailHelpers = require('../helpers/mail.js');

/**
 * @class GoogleMail
 */
class GoogleMail extends MailHelpers.Mailer {
  /**
   * Creates an instance of GoogleMail
   */
  constructor() {
    super();
    this.name = 'GOOGLE_MAILER';
  }

  /**
   * Dispatch emails and update email metadata
   * @param {Object} email
   * @param {Object} credentials
   * @param {Object} tokens
   * @param {Boolean} debugRedirectAll
   * @return {Promise}
   */
  async _attemptDispatch(email, credentials, tokens, debugRedirectAll) {
    let headers = Helpers.kVToObject(email.headers, true);
    headers.SUBJECT = (email.subject) ? email.subject : null;

    const params = {
      html: email.body,
      attachments: email._attachments,
    };

    if (debugRedirectAll) {
      headers = this.debugRedirectAllHeaders(email, headers);
    }

    headers.Date = Sugar.Date.format(Sugar.Date.create(), '%a, %d %b %G %T {ZZ}');

    await this._checkTokenExpiry(credentials, tokens, email);
    const result = await this._dispatchEmail(tokens, headers, params);
    lambda.logDebug(`[${this.name}][${email.id}]: Sent email to ${headers.TO}`);

    // const message = await this._getMessage(tokens.accessToken, result.id, 'metadata');
    // const parsedHeaders = message.payload.headers.reduce((obj, h) => {
    //   if (Sugar.String.underscore(h.name).toUpperCase() === 'SUBJECT') {
    //     obj.subject = h.value;
    //   }
    //   if (Sugar.String.underscore(h.name).toUpperCase() === 'MESSAGE_ID') {
    //     obj.messageId = h.value;
    //   }
    //   if (Sugar.String.underscore(h.name).toUpperCase() === 'IN_REPLY_TO') {
    //     obj.inReplyTo = h.value;
    //   }

    //   return obj
    // }, {});

    email.dispatch.status = 'SENT';
    const updates = [{
      path: 'dispatch.status',
      value: 'SENT',
    }, {
      path: 'dispatch.dispatchedAt',
      value: Sugar.Date.create(),
    }, {
      path: `provider.name`,
      value: 'GOOGLE',
    }, {
      path: `provider.id`,
      value: result.id,
    },
    // {
    //   path: `provider.subject`,
    //   value: (parsedHeaders && parsedHeaders.subject) ? parsedHeaders.subject : null,
    // },
    {
      path: `provider.threadId`,
      value: result.threadId,
    }];

    // if (parsedHeaders && parsedHeaders.messageId) {
    //   updates.push({
    //     path: `provider.messageId`,
    //     value: parsedHeaders.messageId,
    //   });
    // }
    // if (parsedHeaders && parsedHeaders.inReplyTo) {
    //   updates.push({
    //     path: `provider.inReplyTo`,
    //     value: parsedHeaders.inReplyTo,
    //   });
    // }

    return Buttress.getCollection('email').update(email.id, updates);
  }

  async _dispatchEmail(tokens, headers, params) {
    const container = await this.makeEmail(headers, params);
    const raw = this.btoa(container, true);

    try {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`;
      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({
          raw: raw,
        }),
      };
      const result = await lambda.fetch({
        url,
        options,
      });
      if (!result.status || result.status !== 200) throw new Error(result);

      return result.body;
    } catch (err) {
      lambda.logError(err.message);
      throw new Error(err.message);
    }
  }

  /**
   * Check if the user token has expired
   * @param {Object} credentials
   * @param {Object} tokens
   * @param {Object} email
   */
  async _checkTokenExpiry(credentials, tokens, email) {
    try {
      await lambda.fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${tokens.accessToken}`);
    } catch (err) {
      if (err.message.toUpperCase() === 'INVALID_TOKEN' && err.code === 400) {
        lambda.logWarn('Current token has expired, refreshing token');
        await this._refreshToken(credentials, tokens, email);
        return;
      }

      lambda.logError(err.message);
      throw new Error(err.message);
    }
  }

  /**
   * Refreshes user token
   * @param {Object} credentials
   * @param {Object} tokens
   * @param {Object} email
   */
  async _refreshToken(credentials, tokens, email) {
    // Handle no refresh
    if (!tokens.refreshToken && !tokens.privateKey) {
      lambda.logError('No refresh token or private key available');
      throw new Error('No refresh token or private key available');
    }

    let targetUserEmail = email.from;
    const targetUserAuthApp = (tokens.authApp) ? tokens.authApp : 'GOOGLE';

    let accessToken = null;

    try {
      if (!tokens.refreshToken && tokens.privateKey) {
        accessToken = await this._getAccessTokenFromPrivateKey(tokens);

        // We update the email to be the client email from the service account.
        targetUserEmail = tokens.clientEmail;
      } else {
        accessToken = await this._getAccessTokenFromRefresh(credentials, tokens);
      }

      if (!accessToken) {
        lambda.logError('Tried to refresh token but no access token returned');
        throw new Error('Tried to refresh token but no access token returned');
      }

      tokens.accessToken = accessToken;

      const [sender] = await Buttress.getCollection('user').search({
        'auth.app': {
          $eq: targetUserAuthApp,
        },
        'auth.email': {
          $eq: targetUserEmail,
        },
      });
      if (!sender) {
        lambda.logError('Can not find the user (sender) object');
        throw new Error('Can not find the user (sender) object');
      }

      const senderAuthIdx = sender.auth.findIndex((au) => au.email === targetUserEmail && au.app === targetUserAuthApp);
      if (senderAuthIdx === -1) {
        lambda.logError('Can not find the user token index');
        throw new Error('Can not find the user token');
      }

      await Buttress.getCollection('user').update(sender.id, [{
        path: `auth.${senderAuthIdx}.token`,
        value: accessToken,
      }]);
    } catch (err) {
      lambda.logError(err.message);
      throw new Error(err.message);
    }
  }

  async _getAccessToken(body) {
    const url = `https://oauth2.googleapis.com/token`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body
    };

    const result = await lambda.fetch({
      url,
      options,
    });

    if (!result.status || result.status !== 200) throw new Error(result);
    const accessToken = (result.body && result.body.access_token) ? result.body.access_token : null;

    return accessToken;
  }

  _getAccessTokenFromRefresh(credentials, tokens) {
    return this._getAccessToken({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
    });
  }

  async _getAccessTokenFromPrivateKey(tokens) {
    console.silly(`[${this.name}]: Generating access token from private key for ${tokens.clientEmail} and sub ${tokens.sub || 'none'}`);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const jwtHeader = {
      alg: 'RS256',
      typ: 'JWT',
    };

    const jwtPayload = {
      iss: tokens.clientEmail,
      scope: 'https://www.googleapis.com/auth/gmail.send',
      aud: 'https://oauth2.googleapis.com/token',
      exp: nowSeconds + 3600,
      iat: nowSeconds
    };

    if (tokens.sub) {
      jwtPayload.sub = tokens.sub;
    }

    const encodedHeader = Helpers.base64UrlEncode(jwtHeader);
    const encodedPayload = Helpers.base64UrlEncode(jwtPayload);

    // Create the JWT signature
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    const signatureRaw = await lambda.cryptoCreateSign({
      signature: 'RSA-SHA256',
      preSignature: unsignedToken,
      key: tokens.privateKey,
      encodingType: 'base64',
    });

    const signature = signatureRaw.toString()
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return this._getAccessToken({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedToken}.${signature}`,
    });
  }

  async _getMessage(token, messageId, format = 'full') {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?access_token=${token}&format=${format}`;
    const options = {
      method: 'GET',
    };

    const result = await lambda.fetch({
      url,
      options,
    });

    return result.body;
  }
}
module.exports = new GoogleMail();