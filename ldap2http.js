/*
LDAP server that only perform searches, which are redirected to http with the following rules
- The base URL path is passed as command line parameter or in LDAP2HTTP_BASE_URL environment variable
- The search base is appended, replacing commas by slashes and reversing the order
- The filter is passed as "filter" querystring parameter, urlencoded
- The scope is passed as "scope" querystring parameter
*/

/*
Launch
npm start -- --url http://localhost:8010 --port 1389 --bind uid=root --password secret --debug

Invoke (-s [base|one|sub]) base: the object, one: children, sub: all subtree
ldapsearch -H ldap://localhost:1389 -x -D uid=root -w secret -b ou=mathematicians,dc=example,dc=com -s sub objectlass=*
*/

import ldap from 'ldapjs';
import got from 'got';

import { Command } from 'commander';
const commander = new Command();

// Process command line
commander
  .version('0.0.1', '-v, --version')
  .usage('[OPTIONS]...')
  .option('-u, --url <url>', 'url for the http backend. May also use LDAP2HTTP_BACKEND_URL environment variable')
  .option('-p, --port <port>', 'LDAP listening port. May also use LDAP2HTTP_PORT environment variable')
  .option('-b, --bind <bind dn>', 'bind dn. May also use LDAP2HTTP_BIND_DN environment variable')
  .option('-w, --password <bind password>', 'bind password. May also use LDAP2HTTP_BIND_PASSWORD environment variable')
  .option('-d, --debug', 'debug mode')
  .parse(process.argv);

const options = commander.opts();

const baseUrl = (options.url ? options.url : process.env.LDAP2HTTP_BACKEND_URL);
const port = (options.port ? options.port : process.env.LDAP2HTTP_PORT);
const bindDN = (options.bind ? options.bind : process.env.LDAP2HTTP_BIND_DN);
const bindPassword = (options.password ? options.password : process.env.LDAP2HTTP_BIND_PASSWORD);
const debug = options.debug;

if (!baseUrl) throw Error("url not specified");
if (!port) throw Error("port not specified");
if (!bindDN) throw Error("bind dn not specified");
if (!bindPassword) throw Error("pind password not specified");

// Start LDAP server
const server = ldap.createServer();
server.listen(port, () => {
    console.log(`LDAP server listening in port ${port}`);
});

server.bind(options.bind, (req, res, next) => {
    if (req.dn.toString() != bindDN || req.credentials != bindPassword){
        if(debug) console.log(`bad bind with ${req.dn.toString()}`);
        return next(new ldap.InvalidCredentialsError());
    }
    res.end();
    return next();
});

// If we don't handle errors, the program will exit
server.on('error', (e) => {
    console.error(e);
    process.exit();
});

// Search anything
server.search('', async (req, res, next) => {

    // Compose url
    let url = baseUrl +"/" + req.dn.toString().split(",").reverse().join("/") + "?";
    if(req.filter) url += "filter=" + encodeURIComponent(req.filter.toString()) + "&"
    if(req.scope) url += "scope=" + req.scope.toString();
    if(debug) console.log("invoking backend with", url);


    // By default does 2 retries
    got(url, {retry: {limit: 0}}).json().then(
        (json) => {
            // Not taking filter into account. The backend must do it
            // All attributes are returned

            // Send the entries one by one
            json.forEach((entry) => {
                if(debug) console.log("entry:", JSON.stringify(entry));
                res.send(entry);
            });

            if(debug) console.log("response sent");
            res.end();
        },
        (error) => {
            if (error.response.statusCode < 500){
                console.error("not found");
                return next(new ldap.NoSuchObjectError());
            } else {
                console.error("bad error");
                return next(new ldap.UnavailableError());
            }            
        }
    );
});