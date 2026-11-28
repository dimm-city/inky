const fs = require('fs');
const path = require('path');

function filename(mainInkPath) {
    return mainInkPath.replace(/\.ink$/, '') + '.settings.json';
}

function read(mainInkPath) {
    let settings;
    try {
        settings = JSON.parse(fs.readFileSync(filename(mainInkPath), 'utf8'));
    } catch(error) {
        if( error.code == 'ENOENT' ) return {};
        throw error;
    }
    if( !settings || typeof settings != 'object' || Array.isArray(settings) ) {
        throw new Error('The project settings must contain a JSON object.');
    }
    return settings;
}

function webExport(settings, mainInkPath) {
    const saved = settings.webExport;
    if( saved === undefined ) return {};
    if( !saved || typeof saved != 'object' || Array.isArray(saved) ) {
        throw new Error('webExport must contain a JSON object.');
    }
    const result = {};
    for( const key of ['template', 'directory', 'script'] ) {
        const value = saved[key];
        if( value === undefined ) continue;
        if( value !== null && (typeof value != 'string' || !value) ) {
            throw new Error(`webExport.${key} must be a path or null.`);
        }
        if( key == 'script' ) {
            if( value && (/[\\/]/.test(value) || !value.endsWith('.js')) ) {
                throw new Error('webExport.script must be a JavaScript filename.');
            }
            result[key] = value;
        } else {
            result[key] = value ? path.resolve(path.dirname(mainInkPath), value) : null;
        }
    }
    return result;
}

function writeWebExport(mainInkPath, value) {
    const file = filename(mainInkPath), settings = read(mainInkPath);
    const existing = webExport(settings, mainInkPath);
    const saved = { ...settings.webExport, ...existing, ...value };
    for( const key of ['template', 'directory'] ) {
        if( !saved[key] ) continue;
        const relative = path.relative(path.dirname(mainInkPath), saved[key]);
        if( relative != '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) ) {
            saved[key] = relative || '.';
        }
    }
    settings.webExport = saved;
    webExport(settings, mainInkPath);
    let mode = 0o644;
    try {
        const stat = fs.lstatSync(file);
        if( !stat.isFile() ) throw new Error('The project settings must be a regular file.');
        fs.accessSync(file, fs.constants.W_OK);
        mode = stat.mode & 0o777;
    } catch(error) {
        if( error.code != 'ENOENT' ) throw error;
    }
    const temporary = file + '.' + require('crypto').randomUUID() + '.tmp';
    try {
        fs.writeFileSync(temporary, JSON.stringify(settings, null, 4) + '\n', { flag: 'wx', mode });
        fs.renameSync(temporary, file);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
    return settings;
}

module.exports = { filename, read, webExport, writeWebExport };
