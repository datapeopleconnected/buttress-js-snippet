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
    const bytes = await lambdaAPI('cryptoRandomBytes', 16);
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
