const fs = require('fs');
const path = require('path');

// Templates are static web files. No template code is run by the exporter.
async function validateDirectory(directory) {
    const resolved = await fs.promises.realpath(directory);
    try {
        if( !(await fs.promises.stat(path.join(resolved, 'index.html'))).isFile() ) throw new Error('The template folder must contain index.html.');
    } catch(error) {
        if( error.code == 'ENOENT' ) throw new Error('Choose a template folder containing index.html. Extract downloaded ZIP files first.');
        throw error;
    }
    for( const generated of ['story.js', 'ink.js'] ) {
        try {
            await fs.promises.lstat(path.join(resolved, generated));
        } catch(error) {
            if( error.code == 'ENOENT' ) continue;
            throw error;
        }
        throw new Error(`The template must not contain generated file ${generated}.`);
    }
    return resolved;
}

function listDirectories(directory) {
    let entries;
    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch(error) {
        if( error.code == 'ENOENT' ) return [];
        throw error;
    }
    return entries.filter(entry => {
        if( !entry.isDirectory() && !entry.isSymbolicLink() ) return false;
        try {
            return fs.statSync(path.join(directory, entry.name, 'index.html')).isFile();
        } catch(error) {
            if( error.code == 'ENOENT' || error.code == 'ENOTDIR' ) return false;
            throw error;
        }
    }).map(entry => path.join(directory, entry.name)).sort();
}

function contains(parent, child) {
    const relative = path.relative(parent, child);
    return relative == '' || (relative != '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

async function rejectDestinationSymlink(file) {
    try {
        if( (await fs.promises.lstat(file)).isSymbolicLink() ) {
            throw new Error(`Export destination symlinks are not supported: ${file}`);
        }
    } catch(error) {
        if( error.code != 'ENOENT' ) throw error;
    }
}
async function copyDirectory(source, destination, generatedFiles = []) {
    source = await fs.promises.realpath(source);
    const checkDestination = target => {
        if( contains(source, target) || contains(target, source) ) {
            throw new Error('Export to a separate folder outside the template folder.');
        }
    };
    checkDestination(path.resolve(destination));
    await rejectDestinationSymlink(path.resolve(destination));
    await fs.promises.mkdir(destination, { recursive: true });
    checkDestination(await fs.promises.realpath(destination));

    for( const file of generatedFiles ) {
        await rejectDestinationSymlink(path.join(destination, file));
    }

    // Individual file copies also work inside Electron's ASAR archive.
    async function copy(relative = '') {
        for( const name of await fs.promises.readdir(path.join(source, relative)) ) {
            const file = path.join(relative, name);
            const from = path.join(source, file);
            const to = path.join(destination, file);
            const stat = await fs.promises.lstat(from);
            if( stat.isSymbolicLink() ) throw new Error(`Template symlinks are not supported: ${file}`);
            await rejectDestinationSymlink(to);
            if( stat.isDirectory() ) {
                await fs.promises.mkdir(to, { recursive: true });
                await copy(file);
            } else if( stat.isFile() ) {
                if( file != 'index.html' ) await fs.promises.copyFile(from, to);
            } else {
                throw new Error(`Unsupported template file: ${file}`);
            }
        }
    }
    await copy();
}

module.exports = { validateDirectory, listDirectories, copyDirectory, rejectDestinationSymlink, contains };
