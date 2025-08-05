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

const Helpers = require('../helpers/helpers.js');
const MailHelpers = require('../helpers/mail.js');

/**
 * @class MicrosoftMail
 */
class MicrosoftMail extends MailHelpers.Mailer {
  /**
   * Creates an instance of MicrosoftMail
   */
  constructor() {
    super();
    this.name = 'MICROSOFT_MAILER';
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

    const params = {
      html: email.body,
      attachments: email._attachments,
    };

    if (debugRedirectAll) {
      headers = this.debugRedirectAllHeaders(email, headers);
    }

    headers.DATE = Sugar.Date.format(Sugar.Date.create(), '%a, %d %b %G %T {ZZ}');

    const message = await this._createMicrosoftEmail(tokens, headers, params, credentials, email);
    await this._dispatchEmail(tokens, message, credentials, email);
    lambda.logDebug(`[${this.name}][${email.id}]: Sent email to ${headers.TO}`);

    email.dispatch.status = 'SENT';
    const updates = [{
      path: 'dispatch.status',
      value: 'SENT',
    }, {
      path: 'dispatch.dispatchedAt',
      value: Sugar.Date.create(),
    }, {
      path: `provider.name`,
      value: 'MICROSOFT',
    }, {
      path: `provider.id`,
      value: message.id,
    }, {
      path: `provider.subject`,
      value: message.subject,
    }, {
      path: `provider.threadId`,
      value: message.conversationId,
    }];

    if (message.internetMessageId) {
      updates.push({
        path: `provider.messageId`,
        value: message.internetMessageId,
      });
    }
    if (message.replyTo && message.replyTo.length > 0) {
      updates.push({
        path: `provider.inReplyTo`,
        value: message.replyTo,
      });
    }

    return Buttress.getCollection('email').update(email.id, updates);
  }

  async _createMicrosoftEmail(tokens, headers, params, credentials, email) {
    const container = await this.makeEmail(headers, params);
    const raw = this.btoa(container);
    try {
      const url = `https://graph.microsoft.com/v1.0/me/messages`;
      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.accessToken}`,
          'Content-Type': 'text/plain',
          'Prefer': 'IdType="ImmutableId"',
        },
        body: raw
      };

      const result = await lambda.fetch({
        url,
        options,
      });

      return result.body;
    } catch (err) {
      if (err.code === 401) {
        await this._refreshToken(credentials, tokens, email);
        await this._createMicrosoftEmail(tokens, headers, params, credentials, email);
        return;
      }

      lambda.logError(err.message);
      throw new Error(err.message);
    }
  }

  async _dispatchEmail(tokens, message, credentials, email) {
    try {
      const url = `https://graph.microsoft.com/v1.0/me/messages/${message.id}/send`;
      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokens.accessToken}`,
        },
      };
      const result = await lambda.fetch({
        url,
        options,
      });
      if (!result.status || result.status !== 202) throw new Error(result);

    } catch (err) {
      if (err.code === 401) {
        await this._refreshToken(credentials, tokens, email);
        await this._dispatchEmail(tokens, message, credentials, email);
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
      const url = `https://login.microsoftonline.com/${credentials.issuer}/oauth2/v2.0/token`;
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: {
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          scope: credentials.scope,
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

  async _getMessage(token, messageId, format = 'full') {
    const url = `https://graph.microsoft.com/v1.0/me/messages/${messageId}?access_token=${token}&format=${format}`;
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokens.accessToken}`,
        'Prefer: outlook.body-content-type': 'text',
      },
    };

    const result = await lambda.fetch({
      url,
      options,
    });

    return result.body;
  }
}
module.exports = new MicrosoftMail();