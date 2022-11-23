/**
 * @description
 * @author DPC LTD
 */
const getClassesList = () => {
  const classes = [];
  const files = [{
    fileName: 'auth',
    className: 'Auth',
  }, {
    fileName: 'google.js',
    className: 'Google',
  }];
  files.forEach((f) => {
    classes.push({
      [f.className]: require(`${__dirname}/${f.fileName}`),
    });
  });

  return classes;
};

const classes = getClassesList();
const snippets = classes.reduce((file, obj) => {
  if (Object.keys(file).length < 1) return obj;

  const [className] = Object.keys(file);
  obj[className] = file[className];
  return obj;
}, {});

module.exports = snippets;