'use strict';
const MimeMultipart = require('../helpers/mime-multipart');
const MimePart = require('../helpers/mime-part');

/**
 * @class MicrosoftMail
 */
class MicrosoftMail {
  /**
   * Creates an instance of MicrosoftMail
   */
  constructor() {
    this.name = 'MICROSOFT_MAILER';
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
      emailTemplate: email.template,
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

    const params = {
      html: email.body,
      attachments: email._attachments,
    };

    if (catchAll) {
      lambda.logWarn(`[${this.name}][${email.id}]: Catch all enabled; TO: ${headers.To}, CC: ${headers.CC}`);
      delete headers.from;
      delete headers.To;
      delete headers.CC;

      email.subject = `[TESTING]: ${email.subject}`;

      headers.from = lambda.developmentEmailAddress;
      headers.To = lambda.developmentEmailAddress;
    }

    headers.Date = Sugar.Date.format(Sugar.Date.create(), '%a, %d %b %G %T {ZZ}');

    const message = await this._createMicrosoftEmail(tokens, headers, params, credentials, email);
    await this._dispatchEmail(tokens, message, credentials, email);
    lambda.logDebug(`[${this.name}][${email.id}]: Sent email to ${headers.To}`);

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
    const container = await this._makeEmail(headers, params);
    const raw = this._btoa(container);
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
   * @return {String} base64
   */
  _btoa(str) {
    let buffer;

    if (str instanceof Buffer) {
      buffer = str;
    } else {
      buffer = Buffer.from(str.toString(), 'binary');
    }

    return buffer.toString('base64');
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

  _toBase64URL(json) {
    const jsonString = JSON.stringify(json);
    const btyeArray = Buffer.from(jsonString);
    return btyeArray.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
}
module.exports = new MicrosoftMail();