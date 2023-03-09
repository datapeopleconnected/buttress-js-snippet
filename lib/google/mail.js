'use strict';
const MimeMultipart = require('./mime-multipart');
const MimePart = require('./mime-part');

/**
 * @class GoogleMail
 */
class GoogleMail {
  /**
   * Creates an instance of GoogleMail
   */
  constructor() {}

  /**
   * send
   * @param {Object} serviceAccount
   * @param {Object} email
   * @return {Promise}
   */
  async send(serviceAccount, email) {
    email = await this._getEmailTemplate(email);
    await this._attemptDispatch(serviceAccount, email);
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

    email.body = await lambdaAPI('getEmailTemplate', {
      emailId: email.id,
      lambdaId: lambdaInfo.lambdaId,
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
   * @param {Object} serviceAccount
   * @param {Object} email
   * @return {Promise}
   */
  async _attemptDispatch(serviceAccount, email) {
    const headers = this._kVToObject(email.headers);

    const params = {
      html: email.body,
      attachments: email._attachments,
    };

    if (this._catchAll) {
      lambda.logWarn(`[${this.name}][${email.id}]: Catch all enabled; TO: ${headers.To}, CC: ${headers.CC}`);
      delete headers.To;
      delete headers.CC;

      email.subject = `[TESTING]: ${email.subject}`;

      headers.To = this._developmentAddress;
    }

    headers.Date = Sugar.Date.format(Sugar.Date.create(), '%a, %d %b %G %T {ZZ}');

    const authToken = await this._getAuthToken(serviceAccount);
    const result = await this._dispatchEmail(authToken, headers, params);
    lambda.logDebug(`[${this.name}][${email.id}]: Sent email to ${headers.To}`);

    const message = await this._getMessage(authToken, result.id, 'metadata');
    const _email = this._parseMessage(message);
    email.dispatch.status = 'SENT';

    const updates = [{
      path: 'dispatch.status',
      value: 'SENT',
    }, {
      path: 'dispatch.dispatchedAt',
      value: Sugar.Date.create(),
    }, {
      path: 'gmail.id',
      value: message.id,
    }, {
      path: 'gmail.threadId',
      value: message.threadId,
    }];

    if (_email.gmail.messageId) {
      updates.push({
        path: 'gmail.messageId',
        value: _email.gmail.messageId,
      });
    }
    if (_email.gmail.inReplyTo) {
      updates.push({
        path: 'gmail.inReplyTo',
        value: _email.gmail.inReplyTo,
      });
    }

    return Buttress.getCollection('email').update(email.id, updates);
  }

  /**
   * Retrieve Google Mail API Token
   * @param {Object} serviceAccount
   * @return {Promise}
   */
  async _getAuthToken(serviceAccount) {
    const header = {
      alg: 'RS256',
      typ: 'JWT',
    };
    const claimSet = {
      iss: serviceAccount.getValue('ISS'),
      iat: new Date().getTime() / 1000,
      exp: new Date().getTime() / 1000 + (60 * 60),
      scope: 'https://mail.google.com/',
      aud: 'https://oauth2.googleapis.com/token',
      sub: serviceAccount.getValue('SUB'),
    };

    const encodedHeader = this._toBase64URL(header);
    const encodedClaimSet = this._toBase64URL(claimSet);
    const signature = await lambdaAPI('cryptoCreateSign', {
      signature: 'RSA-SHA256',
      preSignature: `${encodedHeader}.${encodedClaimSet}`,
      key: serviceAccount.getValue('PRIVATE_KEY'),
      encodingType: 'base64',
    });
    const encodedSignature = signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const jwt = `${encodedHeader}.${encodedClaimSet}.${encodedSignature}`;

    try {
      const url = `https://oauth2.googleapis.com/token?grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;
      const options = {
        method: 'POST',
        port: 443,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      };
  
      const result = await lambda.fetch({
        url,
        options,
      });
      return result.body.access_token;
    } catch (err) {
      lambda.logError(err);
      throw new Error(err);
    }
  }

  async _dispatchEmail(token, headers, params, labelIds = []) {
    const container = await this._makeEmail(headers, params);
    const raw = this._btoa(container, true);

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`;
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({
          raw: raw,
          labelIds: [labelIds],
      }),
    };

    const result = await lambda.fetch({
      url,
      options,
    });

    if (!result.status || result.status !== 200) throw new Error(result);

    return result.body;
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
  _btoa(str, urlSafe=false) {
    let buffer;

    if (str instanceof Buffer) {
      buffer = str;
    } else {
      buffer = Buffer.from(str.toString(), 'binary');
    }

    if ( urlSafe ) {
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

  _parseMessage(message) {
    const rex = /<((.+)@(.+))>/;
    let parsed = {};
    if (message.payload.headers) {
      parsed = message.payload.headers.reduce((p, h) => {
        switch (h.name.toUpperCase()) {
        default:
          break;
        case 'TO':
          p.to = h.value.split(',').map((t) => {
            if (rex.test(t)) {
              const matches = rex.exec(t);
              return matches[1].toLowerCase();
            }
            return t;
          });
          break;
        case 'FROM':
          p.from = h.value;
          if (rex.test(p.from)) {
            const matches = rex.exec(h.value);
            p.from = matches[1].toLowerCase();
          }
          break;
        case 'SUBJECT':
          p.subject = h.value;
          break;
        case 'MESSAGE-ID':
          p.messageId = h.value;
          break;
        case 'IN-REPLY-TO':
          p.inReplyTo = h.value;
          break;
        }

        return p;
      }, {});
    }

    const emailData = Buttress.getCollection('email').createObject();

    emailData.from = parsed['from'];
    emailData.to = parsed['to'];
    emailData.subject = (parsed['subject']) ? parsed['subject'] : '';
    emailData.status = 'INBOUND';

    if (message.payload.headers) {
      emailData.headers = message.payload.headers.map((header) => {
        return {
          key: header.name,
          value: header.value,
        };
      });
    }

    if (message.payload.parts) {
      emailData.body = message.payload.parts.reduce((body, part) => {
        if (part.mimeType === 'text/plain' && part.body && part.body.data) {
          const buffer = Buffer.from(part.body.data, 'base64');
          body += buffer.toString('ascii').replace(/\n|\r\n|\n\r|\r/g, '<br/>');
        }

        return body;
      }, '');
    }

    if (!emailData.body && message.payload.body && message.payload.body.data) {
      const buffer = Buffer.from(message.payload.body.data, 'base64');
      emailData.body = buffer.toString('ascii');
    }

    emailData.gmail.id = [message.id];
    emailData.gmail.threadId = [message.threadId];
    if (parsed['messageId']) {
      emailData.gmail.messageId = parsed['messageId'];
    }
    if (parsed['inReplyTo']) {
      emailData.gmail.inReplyTo = parsed['inReplyTo'];
    }

    emailData.createdAt = Sugar.Date.create(parseInt(message.internalDate));

    return emailData;
  }

  _toBase64URL(json) {
    const jsonString = JSON.stringify(json);
    const btyeArray = Buffer.from(jsonString);
    return btyeArray.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
}
module.exports = new GoogleMail();