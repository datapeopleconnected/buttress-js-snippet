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

/**
 * Helpers
 * @class Helpers
 */
class Helpers {
  /**
   * Constructor for Helpers
   */
  constructor() {}

  /**
   * return elements as a string
   * @param {string} queryString
   * @return {Object}
   */
  parseQueryString(queryString) {
    if (!queryString) {
      throw new Error('To execute parseQueryString, a query string needs to be provided');
    }
    const params = {};
    const queryStringPairs = queryString.split('&');

    for (const pair of queryStringPairs) {
      const [key, value] = pair.split('=');
      const decodedKey = decodeURIComponent(key);
      const decodedValue = decodeURIComponent(value || '');

      // Exclude keys with null or undefined values
      if (decodedValue !== 'null' && decodedValue !== 'undefined') {
        params[decodedKey] = decodedValue;
      }
    }

    return params;
  }

  base64UrlEncode(data) {
    return Buffer.from(JSON.stringify(data))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
  }

  kVToObject(arr, uppercaseKeys = false) {
    return arr.reduce((obj, i) => {
      if (uppercaseKeys) {
        obj[i.key.toUpperCase()] = i.value;
      } else {
        obj[i.key] = i.value;
      }
      return obj;
    }, {});
  }

  async createMessageHash(message) {
    const data = {
      algorithm: 'sha256',
      message: message,
    }
    return lambda.cryptoCreateHash(data);
  }

  async encryptMessage(message) {
    const data = {
      algorithm: 'aes-256-gcm',
      message: message,
    };
    const {key, iv, ciphertext, authTag} = await lambda.cryptoCreateCipheriv(data);

    return {
      iv,
      key,
      ciphertext,
      authTag,
    };
  }

  async decryptMessage(message, encryptedData) {
    const data = {
      algorithm: 'aes-256-gcm',
      key: encryptedData.key,
      iv: encryptedData.iv,
      authTag: encryptedData.authTag,
      message,
    };

    return await lambda.cryptoCreateDecipheriv(data);
  }
}

module.exports = new Helpers();
