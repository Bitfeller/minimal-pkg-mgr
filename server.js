const fs = require('fs');
const express = require('express');
const path = require('path');
const archiver = require('archiver');

// ----------------------- CONFIG ----------------------- \\
// Either an array of allowed hosts or '*' to allow all
const allowedHosts = '*';
const port = 443;
const path = '/';
const pkgsPath = './pkgs/';


// ----------------------- SERVER ----------------------- \\
let pkgs = {};
let pkgsIndexTime = 0;

function parsePkgStr(pkg) {
    // Syntax: pkg@version
    
    let segments = pkg.split('@');
    
    let name = segments[0] ?? '';
    let version = segments[1] ?? '';

    return {name, version};
}
function sortByVersion(pkgsList) {
    return pkgsList.sort((a, b) => a.localeCompare(b));
}
function zip(src, dest) {
    const output = fs.createWriteStream(dest);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);
    archive.directory(src, false);
    archive.finalize();
}

function indexPkgs() {
    // Complete periodically to update the list of packages
    let index = fs.readdirSync(pkgsPath)
        .filter(file => fs.lstatSync(path.join(pkgsPath, file)).isDirectory());
    pkgs = {};

    for(let pkg of index) {
        let pkgData = parsePkgStr(pkg);
        if(!pkgData.name || !pkgData.version)
            continue;
        if(!pkgs[pkgData.name])
            pkgs[pkgData.name] = [];
        pkgs[pkgData.name].push(pkgData.version);
    }

    for(let pkg in pkgs) {
        pkgs[pkg] = sortByVersion(pkgs[pkg]);
    }

    pkgsIndexTime = Date.now();
}

const app = express();

app.use(express.json());
app.use((req, res, next) => {
    if(allowedHosts == '*') {
        res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
        let origin = req.get('Origin').replaceAll(/http[s]*:\/\//, '').replaceAll(/:[0-9]*/, '');
        if(allowedHosts.includes(origin))
            res.setHeader('Access-Control-Allow-Origin', req.get('Origin'));
    }
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Origin, Content-Type');
    res.header('Access-Control-Allow-Credentials', 'true');
    return next();
});

app.get(path, async (req, res) => {
    
    let resolve = (code, info) => res.status(code).json({status: 'success', info});
    let reject = (code, info) => res.status(code).json({status: 'error', info});

    if(!req.body || req.headers['content-type'] !== 'application/json')
        return reject(400, 'Invalid request');
    
    let body = req.body;
    if(!body.action || typeof body.action !== 'string' || !body.pkg || typeof body.pkg !== 'string')
        return reject(400, 'Invalid request');

    // Syntax: pkg@version
    let pkg = body.pkg;
    let pkgData = parsePkgStr(pkg);
    if(!pkgData.name)
        return reject(400, 'Invalid package name');

    // Check if we've indexed the packages
    if(Date.now() - pkgsIndexTime > 1000 * 60 * 60)
        indexPkgs();
    
    if(!pkgs[pkgData.name])
        return reject(404, 'Package not found');
    
    if(body.action === 'check') {
        let latestVersion = pkgs[pkgData.name][ pkgs[pkgData.name].length - 1 ];
        return resolve(200, latestVersion);
    }

    if(!pkgData.version)
        pkgData.version = pkgs[pkgData.name][ pkgs[pkgData.name].length - 1 ];

    if(pkgData.version) {
        if(!pkgs[pkgData.name].includes(pkgData.version))
            return reject(404, 'Version not found');
    }
    
    // Fetch the package, zip it, and return it
    let pkgPath = path.join(pkgsPath, pkgData.name + '@' + pkgData.version);
    // Check if we've already zipped before
    if(!fs.existsSync(pkgPath + '.zip'))
        zip(pkgPath, pkgPath + '.zip');

    let pkgZip = fs.readFileSync(pkgPath + '.zip');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=' + pkgData.name + '@' + pkgData.version + '.zip');
    res.send(pkgZip);
    return resolve(200, 'Done.');
});

app.listen(port, () => {
    console.log(`Server started on port ${port}`);
    indexPkgs();
});