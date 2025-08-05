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

const MimeMultipart = require('./mime-multipart.js');
const MimePart = require('./mime-part.js');

const Helpers = require('./helpers.js');

/**
 * @class Mailer
 */
class Mailer {
  /**
   * Creates an instance of Mailer
   */
  constructor() {
    this.name = 'MAILER';
  }

  /**
   * send
   * @param {Object} email - Email Object
   * @param {Object} credentials - oAuth service credentials
   * @param {Object} tokens - oAuth tokens
   * @param {Boolean} debugRedirectAll
   * @return {Promise}
   */
  async send(email, credentials, tokens, debugRedirectAll = false) {
    email = await this._buildEmailBody(email);
    await this._attemptDispatch(email, credentials, tokens, debugRedirectAll);
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
    throw new Error('Method _attemptDispatch not implemented');
  } 

  /**
   * Compose an email
   * @param {Object} headers
   * @param {Object} params
   * @return {MimeMultipart} Email
   */
  async makeEmail(headers, params) {
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

  async _buildEmailBody(email) {
    if (!email.template) {
      return email;
    }
    if (email.body) {
      return email;
    }

    const data = Helpers.kVToObject(email.data);

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

  debugRedirectAllHeaders(email, headers) {
    lambda.logWarn(`[${this.name}][${email.id}]: Catch all enabled; TO: ${headers.TO}, CC: ${headers.CC}, BCC: ${headers.BCC}`);

    // Clear out TO, CC, BCC headers
    delete headers.TO;
    delete headers.CC;
    delete headers.BCC;

    headers.SUBJECT = `[TESTING]: ${email.subject}`;

    // ! Bit of a strange way of doing it as the developmentEmail is set by the buttress owner.
    headers.TO = lambdaInfo.developmentEmailAddress;

    return headers;
  }

  /**
   * Encode a string in base-64
   * @param {String} str
   * @return {String} base64
   */
  btoa(str) {
    let buffer;

    if (str instanceof Buffer) {
      buffer = str;
    } else {
      buffer = Buffer.from(str.toString(), 'binary');
    }

    return buffer.toString('base64');
  }
}


module.exports = {
  Mailer
};
