#!/usr/bin/env node
import * as child_process from "child_process";
import * as fs from "fs";
import { performance } from "perf_hooks";
import * as lsp from "vscode-languageserver-protocol/";
import * as lsp_node from "vscode-languageserver-protocol/node";
import { LineTable } from "./line_table";

interface Options {
    jumpToDef: boolean;
}

interface Config {
    files: string[];
    command: string[];
    options: Options;
}

interface Measurement {
    file: string;
    line: number;
    column: number;
    time: number;
    numberOfResults: number;
}

type Reporter = (measurement: Measurement) => void;

namespace Reporters {
    export function human({ file, line, column, time, numberOfResults }: Measurement) {
        console.log(`${file}:${line}:${column} ${time} ms (${numberOfResults} results)`);
    }
    export function csv({ file, line, column, time, numberOfResults }: Measurement) {
        console.log(`${file}:${line}:${column},${time},${numberOfResults}`);
    }
}

const usageString = `
  Usage: lsp-bench [options] [files] -- [language server command]

  Starts a language server with the given command, then hammers
  it with requests based on the files given.

  Options:
    --jump:         Request jump-to-def instead of completions.
    --format=<fmt>: Set output format to one of: ${Object.keys(Reporters).join(', ')}
                    Default is 'human'.
`;

function help(): never {
    console.log(usageString);
    return process.exit(1);
}

let reporter: Reporter = Reporters.human;

function fail(msg: string): never {
    console.error(msg);
    process.exit(1);
}

function parseOptions(): Config {
    let args = process.argv.slice(2);

    let dash = args.indexOf('--');
    if (dash === -1) {
        help();
    }

    let optionArgs = args.slice(0, dash);
    let command = args.slice(dash + 1);

    let files: string[] = [];
    let jumpToDef = false;
    for (let arg of optionArgs) {
        if (!arg.startsWith('-')) {
            files.push(arg);
        } else if (arg === '--jump') {
            jumpToDef = true;
        } else if (arg.startsWith('--format=')) {
            let format = arg.substring('--format='.length);
            if (!Object.keys(Reporters).includes(format)) {
                fail('Unrecognized format: ' + format);
            }
            reporter = Reporters[format as keyof typeof Reporters];
        } else {
            fail('Unrecognized flag: ' + arg);
        }
    }

    for (let file of files) {
        if (!fs.existsSync(file)) {
            fail('File not found: ' + file);
        } else if (fs.statSync(file).isDirectory()) {
            fail('Input must be a file, not a directory: ' + file);
        }
    }

    return {
        files,
        command,
        options: { jumpToDef }
    };
}

async function main(config: Config) {
    let { command, options } = config;
    console.warn(`Starting command: ${command.join(' ')}`);
    let initStart = performance.now();
    let proc = child_process.spawn(command[0], command.slice(1), {
        stdio: ['pipe', 'pipe', 'inherit'] // forward stderr, create pipes for the rest
    });
    let connection = lsp.createMessageConnection(
        new lsp_node.StreamMessageReader(proc.stdout!),
        new lsp_node.StreamMessageWriter(proc.stdin!));
    connection.listen();
    let initEnd = performance.now();
    console.warn("Now listening (took " + Math.round(initEnd - initStart) + " ms)");

    for (let file of config.files) {
        let uri = 'file://' + fs.realpathSync(file);
        let fileId = lsp.TextDocumentIdentifier.create(uri);
        let text = fs.readFileSync(file, 'utf8');
        let lines = text.split(/\r\n?|\n/);
        let lineTable = new LineTable(text);

        let versionNumber = 1;
        let textDocumentItem = lsp.TextDocumentItem.create(uri, 'codeql', versionNumber, text);

        await connection.sendNotification(lsp.DidOpenTextDocumentNotification.type, {
            textDocument: textDocumentItem
        });

        let commentRegex = /^\s*(\*|\/\*|\/\/)/;
        let wordRegex = /[a-z_][a-z_0-9]*/ig;
        let match: RegExpMatchArray | null;
        while ((match = wordRegex.exec(text)) != null) {
            let matchIndex = match.index!;
            let replacedWord = match[0];
            let matchEndIndex = matchIndex + replacedWord.length;
            let { line, column } = lineTable.get1BasedLineAndColumn(matchIndex);
            if (commentRegex.test(lines[line - 1])) {
                continue;
            }
            let startPos = lsp.Position.create(line, column);
            let endPos = lsp.Position.create(line, column + replacedWord.length);

            let startTime = performance.now();

            let modifiedVersion = lsp.VersionedTextDocumentIdentifier.create(uri, ++versionNumber);
            let replacedText = options.jumpToDef
                // jump-to-def: Insert a space afterward.
                ? text.substring(0, matchEndIndex) + ' ' + text.substring(matchEndIndex)
                // completions: Delete the word.
                : text.substring(0, matchIndex) + text.substring(matchEndIndex);
            await connection.sendNotification(lsp.DidChangeTextDocumentNotification.type, {
                textDocument: modifiedVersion,
                contentChanges: [
                    {
                        // range: lsp.Range.create(startPos, endPos),
                        // // not sure if this is supposed to be byte length or what,
                        // // but since we only match ASCII chars it should be the same.
                        // rangeLength: replacedWord.length,
                        text: replacedText,
                    }
                ],
            });
            // Ask for completions.
            let result = options.jumpToDef
                ? await connection.sendRequest(lsp.DefinitionRequest.type, {
                    position: startPos,
                    textDocument: modifiedVersion,
                })
                : await connection.sendRequest(lsp.CompletionRequest.type, {
                    position: startPos,
                    textDocument: modifiedVersion
                });

            // // Restore the original document, but bump version number again.
            await connection.sendNotification(lsp.DidChangeTextDocumentNotification.type, {
                textDocument: lsp.VersionedTextDocumentIdentifier.create(uri, ++versionNumber),
                contentChanges: [
                    {
                        // range: lsp.Range.create(startPos, startPos), // empty range
                        // rangeLength: 0,
                        text: text,
                    }
                ],
            });
            let endTime = performance.now();
            let numberOfResults: number;
            if (!result) {
                numberOfResults = 0;
            } else if (Array.isArray(result)) {
                numberOfResults = result.length;
            } else if ('items' in result) {
                numberOfResults = result.items.length;
            } else {
                numberOfResults = 1;
            }
            reporter({
                file,
                line,
                column,
                numberOfResults,
                time: Math.round(endTime - startTime)
            });
        }
    }
    connection.sendNotification(lsp.ExitNotification.type);
    connection.dispose();
    process.exit(0);
}
main(parseOptions());
