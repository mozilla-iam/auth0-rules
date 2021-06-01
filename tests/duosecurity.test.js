const _ = require('lodash');

const configuration = require('./modules/global/configuration.js');
const context = require('./modules/contexts/context.js');
const Global = require('./modules/global/global.js');
const user = require('./modules/users/user.js');

const loader = require('./modules/rule-loader.js');
const rule = loader.load('duosecurity.js');

const whitelistedUser = require('./modules/users/duosecurity-whitelisted.js');


// jest setup to reset _user and _context, preventing tests from writing to objects
beforeEach(() => {
  _user = _.cloneDeep(user);
  _context = _.cloneDeep(context);
  output = undefined;
});

test('user in LDAP (ad) requires 2FA with enrollment', () => {
  _context.clientID = '7fMOgA3HQ8QxD6nJ9A2JDgfi6qpr33wW';  // login-dev1
  output = rule(_user, _context, configuration, Global);

  expect(output.context.multifactor.host).toEqual(configuration.duo_apihost_mozilla);
  expect(output.context.multifactor.ikey).toEqual(configuration.login_ikey_mozilla);
  expect(output.context.multifactor.provider).toEqual('duo');
  expect(output.context.multifactor.skey).toEqual(configuration.login_skey_mozilla);
  expect(output.context.multifactor.username).toEqual(user.email);
});

test('user in LDAP (ad) requires 2FA', () => {
  output = rule(_user, _context, configuration, Global);

  expect(output.context.multifactor.host).toEqual(configuration.duo_apihost_mozilla);
  expect(output.context.multifactor.ikey).toEqual(configuration.duo_ikey_mozilla);
  expect(output.context.multifactor.provider).toEqual('duo');
  expect(output.context.multifactor.skey).toEqual(configuration.duo_skey_mozilla);
  expect(output.context.multifactor.username).toEqual(user.email);
});

test('whitelisted account has no duo', () => {
  output = rule(whitelistedUser, _context, configuration, Global);

  expect(output.context.multifactor).toEqual(true); 
});

test('email account not verified', () => {
  _user.email_verified = false;

  output = rule(_user, _context, configuration, Global);

  expect(output.context.redirect.url).toMatch('https://sso.mozilla.com/forbidden');
});

test('non-LDAP accounts don\'t require 2FA', () => {
  _context.connectionStrategy = 'firefoxaccounts';
  __context = _.cloneDeep(_context);

  output = rule(_user, _context, configuration, Global);

  expect(output.context).toEqual(__context);
  expect(output.user).toEqual(user);
});
