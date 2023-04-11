/**
 * @description
 * @author DPC LTD
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
    fileName: 'companies-house/auth.js',
    className: 'CompaniesHouseAuth',
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