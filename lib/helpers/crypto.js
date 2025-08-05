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
 * Crypto
 * @class Crypto
 */
class Crypto {
  /**
   * Constructor for Crypto
   */
  constructor() {
    this.name = 'CRYPTO';
  }

  async generateNumericCode(length) {
    // Validate the input length to ensure it's a positive number.
    if (typeof length !== 'number' || length <= 0 || !Number.isInteger(length)) {
      console.error("Error: Code length must be a positive integer.");
      return '';
    }

    // Calculate the maximum possible number for the given length.
    // For example, if length is 6, max is 999999.
    const max = Math.pow(10, length) - 1;
    // Calculate the minimum possible number for the given length.
    // For example, if length is 6, min is 100000.
    const min = Math.pow(10, length - 1);

    const randomBytes = await cryptoRandomBytes(4);
    const randomNumber = this.readUInt32LE(randomBytes, 0);

    // Scale the random number to fit within our desired range [min, max].
    // The modulo operator ensures the number is within the range [0, (max - min)].
    // Adding 'min' shifts it to the desired [min, max] range.
    let code = (randomNumber % (max - min + 1)) + min;

    return String(code).padStart(length, '0');
  }

  readUInt32LE(byteArray, offset) {
    // Ensure the offset is valid and there are enough bytes to read a 32-bit integer (4 bytes).
    if (offset < 0 || offset + 4 > byteArray.length) {
        throw new Error("Offset out of bounds or not enough bytes to read a 32-bit unsigned integer.");
    }

    const byte0 = byteArray[offset];     // Least significant byte
    const byte1 = byteArray[offset + 1];
    const byte2 = byteArray[offset + 2];
    const byte3 = byteArray[offset + 3]; // Most significant byte

    const value = (byte3 << 24) | (byte2 << 16) | (byte1 << 8) | byte0;

    return value >>> 0;
  }
}

module.exports = new Crypto();