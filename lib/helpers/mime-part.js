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

/**
 * MimePart
 * @class MimePart
 */
 class MimePart {
    /**
     * Constructor for MimePart
     * @param {*} mimeType
     * @param {*} headers
     * @param {*} body
     */
    constructor(mimeType, headers, body) {
      this._mimeType = mimeType;
      this._body = body;
      this._headers = [];
      for (const header in headers) {
        if (!headers.hasOwnProperty(header)) continue;
        this._headers.push(`${header}: ${headers[header]}`);
      }
    }
  
    /**
     * return elements as a string
     * @return {String}
     */
    toString() {
      let elements = this._build();
  
      elements = elements.reduce((prev, e) => {
        return prev+`${e}\r\n`;
      }, '');
  
      return elements;
    }
  
    /**
     * build part with headers
     * @return {Array}
     */
    _build() {
      this._headers.splice(0, 0, `Content-Type: ${this._mimeType}`);
      const elements = this._headers;
  
      elements.push('');
      elements.push(this._body);
  
      return elements;
    }
  }
  
  module.exports = MimePart;
  