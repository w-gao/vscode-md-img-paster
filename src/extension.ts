import * as vscode from 'vscode';
import * as path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { spawn } from 'child_process';


/**
 * Get a somewhat random string with a fixed length.
 */
const generateRandomString = (length: number): string => {
    return Array(length).fill("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz").map(x => x[Math.floor(Math.random() * x.length)]).join('');
};


/**
 * Get a nicely formatted date time string like: "12-18-2022 1:25:06 PM".
 */
const getPrettyTime = (): string => {
    return new Date().toLocaleString("en-US").replaceAll(',', '').replaceAll('/', '-');
};


const checkIfClipboardIsImage = (): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        try {
            const ps = spawn('osascript', ['-e', 'clipboard info']);

            ps.stdout.on('data', (raw: Uint8Array) => {
                const data = raw.toString();
                if (data.includes("picture")) {
                    resolve();
                } else {
                    reject("clipboard is not an image");
                }
            });

            ps.stderr.on('data', data => {
                console.debug(`stderr: ${data}`);
            });

            ps.on('error', err => reject(`subprocess error: ${err}`));
        } catch (err) {
            reject(`subprocess error: ${err}`);
        }
    });
};


const promptForFilename = (defaultName: string): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
        vscode.window.showInputBox({
            prompt: 'Please specify the filename of the image.',
            value: defaultName
        }).then((value?: string) => {
            if (value === undefined) {
                reject(null);	// canceled
                return;
            }

            let filename = value.trim();

            if (!filename) {
                reject("you entered an empty filename");
                return;
            }

            // Let's prevent access to parent directories for now.
            if (filename.indexOf("..") >= 0) {
                reject("invalid filename (cannot contain \"..\")");
                return;
            }

            if(!filename.endsWith(".png")) {
                filename += ".png";
            }

            resolve(filename);
        });
    });
};


const getAbsPath = (rootPath: string, folder: string, filename: string, failIfExists: boolean = true): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
        const imgPath = path.join(rootPath, folder, filename);

        // Make sure the parent directory exists. Note that filename is the user input, and could contain sub-folders.
        const dirPath = path.dirname(imgPath);
        if (!existsSync(dirPath)){
            mkdirSync(dirPath, { recursive: true });
        }

        // Make sure the image file does not already exist.
        if (failIfExists && existsSync(imgPath)) {
            // vscode.window.showInformationMessage(`${filename} already exists.`, "Enter new name", "Replace", "Cancel")
            // 	.then(value => { });
            reject("duplcate filename");
            return;
        }
    
        resolve(imgPath);
    });
};


const saveClipboardToFile = (absPath: string): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
        try {
            const dirname = path.dirname(absPath);
            const filename = path.basename(absPath);
            const ps = spawn('osascript', ['-e', `tell application "System Events" to write (the clipboard as «class PNGf») to (make new file at folder "${dirname}" with properties {name:"${filename}"})`]);

            ps.on('close', code => {
                if (code !== 0) {
                    reject(`recieved unexpected exit code: ${code}`);
                    return;
                }

                resolve(absPath);
            });

            ps.stderr.on('data', (data: Uint8Array) => {
                if (data.toString().includes("error")) {
                    reject(data);
                }
            });

            ps.on('error', err => reject(`subprocess error: ${err}`));
        } catch (err) {
            reject(`subprocess error: ${err}`);
        }
    });
};


const writeImageMarkdown = (editor: vscode.TextEditor, relPath: string): Promise<void> => {
    const text  = `![image](${relPath.replaceAll(' ', '%20')})\n`;

    return new Promise<void>((resolve, reject) => {
        editor.edit(edit => {
            let current = editor.selection;
            if (current.isEmpty) {
                edit.insert(current.start, text);
            } else {
                // Replace selection.
                edit.replace(current, text);
            }

        }).then(() => resolve());
    });
};


/**
 * Paste image from clipboard.
 *
 * @param folder The path under root in which the image should be stored.
 * @param defaultName The default name of the image. This could be replaced by the user.
 * @returns 
 */
const pasteImage = (folder: string, defaultName: string) => {

    if(vscode.workspace.workspaceFolders === undefined) {
        vscode.window.showInformationMessage("No workspace opened!");
        return;
    }

    const rootPath = vscode.workspace.workspaceFolders[0].uri.path;
    // console.debug(`rootPath=${rootPath}`);

    const textEditor = vscode.window.activeTextEditor;
    if (!textEditor) {
        vscode.window.showInformationMessage("Please select a document first.");
        return;
    }

    if (textEditor.document.isUntitled) {
        vscode.window.showInformationMessage("Please save the document so we can get the path.");
        return;
    }

    // Get the file URI
    const uri = textEditor.document.fileName;

    // If file does not seem to be markdown, ask the user if they want to continue.
    new Promise<void>((resolve, reject) => {
        if (!(uri.endsWith(".markdown") || uri.endsWith(".md"))) {
            vscode.window.showInformationMessage("The file extension does not end in .md or .markdown. Do you want to continue?", "Continue", "Cancel")
                .then((value) => {
                    if (value === "Continue") {
                        resolve();
                        return;
                    }
                    reject(null);  // no need to log error
                });
            return;
        }

        resolve();
    })

    // Make sure we are working with an image first.
    .then(() => checkIfClipboardIsImage())

    // Great, now ask for a filename.
    .then(() =>  promptForFilename(defaultName))

    // Generate the absolute path for the image.
    .then(filename => getAbsPath(rootPath, folder, filename, true))

    // Save clipboard to a file.
    .then((imgPath) => {
        vscode.window.showInformationMessage(`Saving file to ${imgPath}...`);
        return saveClipboardToFile(imgPath);
    })

    // Write markdown.
    .then((imgPath) => {
        const relPath = path.relative(path.dirname(uri), imgPath);
        return writeImageMarkdown(textEditor, relPath);
    })

    // Uh oh, something went wrong.
    .catch(reason => {
        if (reason instanceof Error) {
            reason = reason.message;
        }

        if (reason) {
            vscode.window.showErrorMessage(`Failed to paste image: ${reason}.`);
            console.warn(reason);
        }
    });

    return;
};

export function activate(context: vscode.ExtensionContext) {
    console.log("vscode-md-img-paster triggered!");

    let disposable = vscode.commands.registerCommand('vscode-md-img-paster.pasteImg', () => {
        let platform = process.platform;
        if (platform !== "darwin") {
            vscode.window.showErrorMessage(`md-img-paster does not work on ${platform}.`);
            return;
        }

        pasteImage("images", `img_${getPrettyTime()}.png`);
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {

}
