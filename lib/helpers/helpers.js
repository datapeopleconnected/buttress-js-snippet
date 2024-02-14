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
}

module.exports = new Helpers();
