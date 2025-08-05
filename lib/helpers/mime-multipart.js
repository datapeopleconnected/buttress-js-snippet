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

const MimePart = require('./mime-part.js');

/**
 * MimeMultipart
 * @class
 */
class MimeMultipart extends MimePart {
  /**
   * Constructor for MimeMultipart
   * @param {*} mimeType
   * @param {*} headers
   */
  constructor(mimeType, headers) {
    super(mimeType, headers);

    this._parts = [];
    this._uniqueId = null;
  }

  async generateUniqueId() {
    this._uniqueId = await this._generateUniqueId();
  }

  /**
   * Add data part
   * @param {MimePart} part
   */
  addPart(part) {
    this._parts.push(part);
  }

  /**
   * Get Unique Id for MimeMultipart
   * @return {String} uniqueId
   */
  getUniqueId() {
    return this._uniqueId;
  }

  /**
   * Build parts into a section
   * @return {Array}
   */
  _build() {
    this._headers.splice(0, 0, `Content-Type: ${this._mimeType}; boundary=${this._uniqueId}`);

    let elements = this._headers;

    this._parts.forEach((p) => {
      elements.push('');
      elements.push(`--${this._uniqueId}`);
      elements = elements.concat(p._build());
    });

    elements.push('');
    elements.push(`--${this._uniqueId}--`);

    return elements;
  }

  /**
   * Generate a Unique Id
   * @return {String} uniqueId
   */
  async _generateUniqueId() {
    const bytes = await lambda.cryptoRandomBytes(16);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const mask = 0x3d;

    let uniqueId = '';
    for (let byte = 0; byte < bytes.length; byte++) {
      uniqueId += chars[bytes[byte] & mask];
    }

    return uniqueId;
  }
}

module.exports = MimeMultipart;
