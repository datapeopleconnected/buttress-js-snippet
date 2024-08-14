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

const getClassesList = () => {
  const classes = [];
  const files = [{
    fileName: 'google/auth.js',
    className: 'GoogleAuth',
  }, {
    fileName: 'google/mail.js',
    className: 'GoogleMail',
  }, {
    fileName: 'microsoft/auth.js',
    className: 'MicrosoftAuth',
  }, {
    fileName: 'microsoft/mail.js',
    className: 'MicrosoftMail',
  }, {
    fileName: 'companies-house/auth.js',
    className: 'CompaniesHouseAuth',
  }, {
    fileName: 'hmrc/auth.js',
    className: 'HMRCAuth',
  }, {
    fileName: 'helpers/helpers.js',
    className: 'Helpers',
  }, {
    fileName: 'payment/stripe.js',
    className: 'Stripe',
  }];

  files.forEach((f) => {
    classes.push({
      [f.className]: require(`${__dirname}/${f.fileName}`),
    });
  });

  return classes;
};

const classes = getClassesList();
const snippets = classes.reduce((obj, file) => {
  if (Object.keys(file).length < 1) return obj;

  const [className] = Object.keys(file);
  obj[className] = file[className];
  return obj;
}, {});

module.exports = snippets;