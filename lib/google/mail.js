'use strict';

/**
 * Buttress - The federated real-time open data platform
 * Copyright (C) 2016-2024 Data People Connected LTD.
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

const MimeMultipart = require('../helpers/mime-multipart');
const MimePart = require('../helpers/mime-part');

/**
 * @class GoogleMail
 */
class GoogleMail {
  /**
   * Creates an instance of GoogleMail
   */
  constructor() {
    this.name = 'GOOGLE_MAILER';
  }

  /**
   * send
   * @param {Object} email
   * @param {Object} credentials
   * @param {Object} tokens
   * @param {Boolean} catchAll
   * @return {Promise}
   */
  async send(email, credentials, tokens, catchAll = false) {
    email = await this._getEmailTemplate(email);
    await this._attemptDispatch(email, credentials, tokens, catchAll);
  }

  _kVToObject(arr) {
    return arr.reduce((obj, i) => {
      obj[i.key] = i.value;
      return obj;
    }, {});
  };

  /**
   * Populate the email body if empty
   * @param {Object} email
   * @return {Promise}
   */
  async _getEmailTemplate(email) {
    if (!email.template) {
      return Promise.resolve(email);
    }
    if (email.body) {
      return Promise.resolve(email);
    }

    const data = this._kVToObject(email.data);

    email.body = await lambda.getEmailTemplate({
      emailId: email.id,
      gitHash: lambdaInfo.gitHash,
      emailData: data,
      emailTemplate: `${email.template}.pug`,
    });

    await Buttress.getCollection('email').update(email.id, [{
      path: 'body',
      value: email.body,
    }]);

    return email;
  }

  /**
   * Dispatch emails and update email metadata
   * @param {Object} email
   * @param {Object} credentials
   * @param {Object} tokens
   * @param {Boolean} catchAll
   * @return {Promise}
   */
  async _attemptDispatch(email, credentials, tokens, catchAll) {
    const headers = this._kVToObject(email.headers);
    headers.subject = (email.subject) ? email.subject : null;

    const params = {
      html: email.body,
      attachments: email._attachments,
    };

    if (catchAll) {
      lambda.logWarn(`[${this.name}][${email.id}]: Catch all enabled; TO: ${headers.To}, CC: ${headers.CC}`);
      delete headers.To;
      delete headers.CC;

      headers.subject = `[TESTING]: ${email.subject}`;
      headers.from = lambda.developmentEmailAddress;
      headers.To = lambda.developmentEmailAddress;
    }

    headers.Date = Sugar.Date.format(Sugar.Date.create(), '%a, %d %b %G %T {ZZ}');

    await this._checkTokenExpiry(credentials, tokens, email);
    const result = await this._dispatchEmail(tokens, headers, params);
    lambda.logDebug(`[${this.name}][${email.id}]: Sent email to ${headers.To}`);

    const message = await this._getMessage(tokens.accessToken, result.id, 'metadata');
    const parsedHeaders = message.payload.headers.reduce((obj, h) => {
      if (Sugar.String.underscore(h.name).toUpperCase() === 'SUBJECT') {
        obj.subject = h.value;
      }
      if (Sugar.String.underscore(h.name).toUpperCase() === 'MESSAGE_ID') {
        obj.messageId = h.value;
      }
      if (Sugar.String.underscore(h.name).toUpperCase() === 'IN_REPLY_TO') {
        obj.inReplyTo = h.value;
      }

      return obj
    }, {});

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
      value: message.id,
    }, {
      path: `provider.subject`,
      value: (parsedHeaders && parsedHeaders.subject) ? parsedHeaders.subject : null,
    }, {
      path: `provider.threadId`,
      value: message.threadId,
    }];

    if (parsedHeaders && parsedHeaders.messageId) {
      updates.push({
        path: `provider.messageId`,
        value: parsedHeaders.messageId,
      });
    }
    if (parsedHeaders && parsedHeaders.inReplyTo) {
      updates.push({
        path: `provider.inReplyTo`,
        value: parsedHeaders.inReplyTo,
      });
    }

    return Buttress.getCollection('email').update(email.id, updates);
  }

  async _dispatchEmail(tokens, headers, params) {
    const container = await this._makeEmail(headers, params);
    const raw = this._btoa(container, true);

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
    try {
      const url = `https://oauth2.googleapis.com/token`;
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: {
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
        }
      };

      const result = await lambda.fetch({
        url,
        options,
      });

      if (!result.status || result.status !== 200) throw new Error(result);
      const accessToken = (result.body && result.body.access_token) ? result.body.access_token : null;
      tokens.accessToken = accessToken;

      // get buttress user ID
      const [sender] = await Buttress.getCollection('user').search({
        'auth.email': {
          $eq: email.from,
        },
      });
      if (!sender) {
        lambda.logError('Can not find the user (sender) object');
        throw new Error('Can not find the user (sender) object');
      }
      await Buttress.getCollection('user').search({
        'auth.email': {
          $eq: email.from,
        },
      });
      const senderAuthIdx = sender.auth.findIndex((au) => au.email === email.from);
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

  /**
   * Compose an email
   * @param {Object} headers
   * @param {Object} params
   * @return {MimeMultipart} Email
   */
  async _makeEmail(headers, params) {
    const container = new MimeMultipart('multipart/mixed', headers);
    await container.generateUniqueId();

    if (params.text && !params.html) {
      container.addPart(new MimePart('text/plain', {}, params.text));
    }

    if (params.html && !params.text) {
      container.addPart(new MimePart('text/html', {}, params.html));
    }

    if (params.html && params.text) {
      const alternative = new MimeMultipart('multipart/alternative', {});
      alternative.addPart(new MimePart('text/plain', {}, params.text));
      alternative.addPart(new MimePart('text/html', {}, params.html));
      container.addPart(alternative);
    }

    return container;
  }

  /**
   * Encode a string in base-64
   * @param {String} str
   * @param {Boolean} urlSafe
   * @return {String} base64
   */
  _btoa(str, urlSafe = false) {
    let buffer;

    if (str instanceof Buffer) {
      buffer = str;
    } else {
      buffer = Buffer.from(str.toString(), 'binary');
    }

    if (urlSafe) {
      return buffer.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    }

    return buffer.toString('base64');
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

  _toBase64URL(json) {
    const jsonString = JSON.stringify(json);
    const btyeArray = Buffer.from(jsonString);
    return btyeArray.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
}
module.exports = new GoogleMail();