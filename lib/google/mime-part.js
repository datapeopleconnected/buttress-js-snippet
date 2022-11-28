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
  