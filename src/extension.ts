import * as vscode from 'vscode';
import * as path from 'path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';


/**
 * Get a somewhat random string with a fixed length.
 */
const generateRandomString = (length: number): string => {
	return Array(length).fill("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz").map(x => x[Math.floor(Math.random() * x.length)]).join('');
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

			let filename = value.trim().replace(' ', '\\ ');

			if (!filename) {
				reject("you entered an empty filename");
				return;
			}

			// It looks like MacOS only disallows the path separator character in a filename, but we should switch to
			// regex if we want to prohibit more characters.
			if (filename.indexOf("/") >= 0) {
				reject("invalid filename (cannot contain \"/\")");
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

		// Make sure this file does not exist.
		if (failIfExists && existsSync(imgPath)) {
			// vscode.window.showInformationMessage(`${filename} already exists.`, "Enter new name", "Replace", "Cancel")
			// 	.then(value => { });
			reject("duplcate filename");
			return;
		}
	
		resolve(imgPath);
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
	new Promise((resolve, reject) => {
		if (!(uri.endsWith(".markdown") || uri.endsWith(".md"))) {
			vscode.window.showInformationMessage("The file extension does not end in .md or .markdown. Do you want to continue?", "Continue", "Cancel")
				.then((value) => {
					if (value === "Continue") {
						resolve(null);
						return;
					}
					reject(null);  // no need to log error
				});
			return;
		}

		resolve(null);
	})

	// Make sure we are working with an image first.
	.then(() => checkIfClipboardIsImage())

	// Great, now ask for a filename.
	.then(() =>  promptForFilename(defaultName))

	// Generate the absolute path for the image.
	.then(filename => getAbsPath(rootPath, folder, filename, true))

	.then((imgPath) => {

		vscode.window.showInformationMessage(imgPath);

		// const dirname = path.dirname(uri);
		// const relPath = path.relative(dirname, path.join(rootPath, "images", "img_test.png"));
	})

	// Write markdown.
	.then(() => {})

	// Uh oh, something went wrong.
	.catch(reason => {
		if (reason) {
			if (reason instanceof Error) { reason = reason.message; }
			vscode.window.showErrorMessage(`Failed to paste image: ${reason}.`);
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

		pasteImage("images", `img_${generateRandomString(6)}.png`);
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {

}
