#!/usr/bin/env node

import * as fsp from "fs/promises"
import * as path from "path"
import { exit } from "process"

let MAXDEPTH = 1        // how many directories deep do we look if we don't recognize anything
let VERBOSE = false     // if true, print a summary of child files and directories
let FOLLOWDOT = false   // if true, look into dot (hidden) directories as well as regular directories
                        // TODO the FOLLOWDOT option should be changed to look into all special directory names such as revDNS and UUID

async function main() {
    let args: string[] = processCommandline(process.argv)
    
    for (let i = 0; i < args.length; ++i) {
        await processFilename(0, args[i])
    }
}

main()

exit

//////// Classes, types, interfaces that are used in various places in this project

// just the parts of the Stats class we use, plus an error field
// we use this when stat() fails, which happens on broken softlinks
// the code only checks the size field if isFile() is true but the
// type checking still wants it
// we add an error field so we can return info
type extensionObject = { [index: string]: number }
type collection = DirentStat[] | string[] | extensionObject

interface DirentStat {
    isFile: () => boolean
    isDirectory: () => boolean
    name: string
    size?: number
    statError?: string
}

//////// Generic functions that could be used outside this project

// split up one array into N arrays based on N-1 tests. The last array holds the elements that didn't pass any of the tests.
function collate<T>(input: T[], tests: ((d: T) => boolean)[]): Array<Array<T>> {
    return input.reduce(
        (a: T[][], d: T) => {
            let index = tests.length;
            tests.some((t, i) => {
                const r = t(d)
                if (r) index = i
                return r
            })

            a[index].push(d)
            return a
        }, Array.from({length: tests.length + 1}, e => Array())
    )
}

//////// Functions used just once in main

function processCommandline(argv: string[]) {
    let args: string[] = []

    for (let i = 2; i < argv.length; ++i) {
        const arg = argv[i]

        if (arg[0] === '-') {
            if (arg.length === 2) {
                switch (arg[1]) {
                    case 'v':
                        VERBOSE = true
                        break
                    case 'd':
                        FOLLOWDOT = true
                }
            } else {
                const kv = arg.substring(1).split('=')
                if (kv.length === 2 && kv[0].length === 1) {
                    switch (kv[0][0]) {
                        case 'm':
                            const numpi = parseInt(kv[1], 10)
                            const numnum = Number(kv[1])
                            if (numpi === numnum)
                                MAXDEPTH = numnum
                            break
                    }
                }
            }
        }
        else
            args.push(arg)
    }
    return args
}

//////// Functions used in various places in this project

function printText(depth: number, text: string): void {
    console.log(`${' '.repeat(depth)}${text}`)
}

function printEntry(depth: number, entry: string): void {
    printText(depth, '<' + entry + '>')
}

function printAnswer(depth: number, answer: string): void {
    printText(depth, "=> " + answer)
}

function printError(depth: number, msg: string): void {
    printText(depth, "* " + msg)
}

// function printCollectionAnswer(depth: number, num: number, kind: string): void {
//     printAnswer(depth, `a collection of ${num} ${kind} files`)
// }

////////

function includesAll(dirents: string[], filenames: string[]): boolean {
    return filenames.every(n => dirents.some(d => d === n))
}

function includesAny(dirents: string[], filenames: string[]): boolean {
    return filenames.some(n => dirents.some(d => d === n))
}

function includes(strings: string[], str: string[]): boolean {
    return strings.includes(str[0])
}

async function processDirents(depth: number, filename: string, dirents: DirentStat[]) {
    printEntry(depth, filename)
        
    //const revDNSRegex = new RegExp(/^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+$/)
    const UUIDRegex     = new RegExp(/^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$|^[0-9A-Fa-f]{32}$/)

    // zero-length files are an orthogonal collection
    const zeroLenFilenames = dirents.filter(d => {
        return d.isFile() && d.size === 0
    }).map(d => d.name)

    // separate non-dirs into files, broken ones like symlinks that throw an exception, and "unknown" ones that are types other than files and dirs
    // keep all three as entries
    const [
        brokenEntries,              // 0
        unknownEntries,             // 1
        dotFiles,                   // 2
        normalFiles,                // 3
        dotDirectories,             // 4
        //reverseDNSDirectories,    // 5
        directoriesWithExtensions,  // 6
        UUIDDirectories,            // 7
        normalDirectories,          // 8
        shouldBeEmpty,              // EXTRA!
    ] = collate(
        dirents, [
            d => d.statError !== undefined,                     // 0 broken
            d => !d.isFile() && !d.isDirectory(),               // 1 unknown type
            d => d.isFile() && d.name[0] === '.',               // 2 dot file
            d => d.isFile(),                                    // 3 normal file
            d => d.isDirectory() && d.name[0] === '.',          // 4 dot dir
            //d => d.isDirectory() && revDNSRegex.test(d.name), // 5 reverse dns: com.apple.foo.bar
            d => d.isDirectory() && d.name.includes('.'),       // 6 dir with file extension
            d => d.isDirectory() && UUIDRegex.test(d.name),     // 7 UUID
            d => d.isDirectory(),                               // 8 normal dir
        ]
    ).map(dsa => dsa.map(ds => ds.name))
    
    if (shouldBeEmpty.length !== 0) {
        console.log("*** an entry did not get collated into any category!", shouldBeEmpty)
    }

    // arrays of strings
    const fileExtensions = normalFiles.filter(n => n.includes('.')).map(d => path.extname(d))
    const dirExtensions = directoriesWithExtensions.map(d => path.extname(d))

    const fileextObj = countArrayFieldsToObject(fileExtensions, true)
    const dirextObj = countArrayFieldsToObject(dirExtensions, false)

    let identified = false

    if (dirents.length === 0) {
        printAnswer(depth, "empty")
        identified = true
    } else {
        const answers: string[] = autoIdentify(
            normalDirectories, dotDirectories, dirExtensions,
            normalFiles, dotFiles, fileExtensions)

        if (answers.length) {
            identified = true
            answers.forEach(ans => printAnswer(depth, ans))
        } else {
            const foundCollection = checkForCollections(fileextObj, fileExtensions)
            if (foundCollection !== undefined) {
                identified = true
                printAnswer(depth, foundCollection)
            }
        }

        if (!identified) printAnswer(depth, "unidentified")

        checkAdditionalNotes(dotDirectories, normalFiles, dotFiles)
            .forEach(add => printAnswer(depth, `  with ${add}`))

        if (!identified) {
            const collections: [collection, string][] = [
                [ brokenEntries,                "broken" ],
                [ normalFiles,                  "files" ],
                [ normalDirectories,            "dirs" ],
                [ zeroLenFilenames,             "zero byte files" ],
                [ dotFiles,                     "dot files" ],
                [ dotDirectories,               "dot dirs" ],
                [ directoriesWithExtensions,    "dirs with extensions" ],
                [ unknownEntries,               "neither files nor dirs" ],
                [ dirextObj,                    "dir extensions" ],
                [ fileextObj,                   "file extensions" ],
                //[ reverseDNSDirectories,      "reverse-DNS dirs" ],
                [ UUIDDirectories,              "UUID dirs" ],
            ]

            if (VERBOSE) verboseSummary(depth, collections)

            const whichDirectories = [
                ...normalDirectories,
                ...directoriesWithExtensions,
                ...FOLLOWDOT
                    //? [...dotDirectories, ...reverseDNSDirectories, ...UUIDDirectories]
                    ? [...dotDirectories, ...UUIDDirectories]
                    : []
            ]
            for (let i = 0; i < whichDirectories.length; ++i) {
                const childdirname = path.join(filename, whichDirectories[i])

                if (depth < MAXDEPTH) {
                    printText(depth, '{')
                    await processFilename(depth + 1, childdirname)
                    printText(depth, '}')
                }
            }
        }
    }
}

function checkAdditionalNotes(dotDirectories: string[], normalFiles: string[], dotFiles: string[]) {
    let additional = []
    
    // Git
    if (includes(dotDirectories, [".git"]))
        if (includes(dotDirectories, [".github"]))
            additional.push("Github Git repository")
        else
            additional.push("Git repository")

    // Mac Finder
    // TODO there is also .localized but it can be both a zero-byte file and a file/directory extension, and it's not related to Finder
    if (includes(normalFiles, ["Icon\r"]) || includes(dotFiles, [".DS_Store"]))
        additional.push("Mac Finder files")

    return additional
}

function autoIdentify(
    normalDirectories: string[], dotDirectories: string[], dirExtensions: string[],
    normalFiles: string[], dotFiles: string[], fileExtensions: string[]
) {
    type step = [ string[], (a:string[], b:string[]) => boolean, string[] ]
    type entry = { name: string, steps: step[] }
    const table: entry[] = [
        {
            name: "Android Studio or IntelliJ IDEA project", steps: [
                [dotDirectories, includes, [".idea"]]
            ]
        },
        // Carbon ?
        {
            name: "Clojure project", steps: [
                [normalFiles, includes, ["project.clj"]],
                [normalDirectories, includesAll, [/*"doc", */"src", "test"]],
            ]
        }, {
            name: "Crystal project", steps: [
                [dotFiles, includesAll, [".gitignore", ".editorconfig"]],
                [normalFiles, includesAll, ["LICENSE", "README.md", "shard.yml"]],
                [normalDirectories, includesAll, ["src", "spec"]],
            ]
        },
        {
            name: "D (DUB) project", steps: [
                [normalFiles, includesAny, ["dub.json", "dub.sdl"]],
            ]
        }, {
            name: "Dart package", steps: [
                [normalFiles, includes, ["pubspec.yaml"]],
                [normalDirectories, includes, ["lib"]],
            ]
        }, {
            name: "Deno folder", steps: [
                [normalFiles, includesAny, ["deno.json", "deno.jsonc"]],
            ]
        }, {
            name: "Eclipse workspace", steps: [
                [dotFiles, includesAll, [".classpath", ".project"]],
                [dotDirectories, includes, [".settings"]],
                [normalDirectories, includesAll, ["bin", "src"]],
            ]
        },
        // Elixir ?
        // Erlang ?
        {
            name: "Flutter project", steps: [
                [dotDirectories, includesAll, [".dart_tool", ".idea"]],
                [normalDirectories, includesAll, ["android", "ios", "lib", "test"]],
                [dotFiles, includesAll, [".gitignore", ".metadata", ".packages"]],
                [normalFiles, includesAll, ["demo_app.iml", "pubspec.lock", "pubspec.yaml"/*, "README.md"*/]]
            ]
        },
        {
            name: "Ghidra project", steps: [
                [normalDirectories, includesAll, ["idata", "user", "versioned"]],
                [normalFiles, includesAll, ["project.prp", "projectState"]],
            ]
        }, {
            name: "Git repository .git directory", steps: [
                [normalFiles, includesAll, ["HEAD", "config", "description"]],
                [normalDirectories, includesAll, ["hooks", "info", "objects", "refs"]],
            ]
        }, {
            name: "Go module", steps: [
                [normalFiles, includes, ["go.mod"]],
            ]
        }, {
            name: "Gradle project", steps: [
                [normalFiles, includes, ["build.gradle"]],
            ]
        },
        // Groovy ?
        {
            name: "Hack project", steps: [
                [dotFiles, includes, [".hhconfig"]],
            ]
        },
        // Haskell ? 
        // Jai ?
        {
            name: "Julia package", steps: [
                [normalFiles, includes, ["Project.toml"]],
                [normalDirectories, includes, ["src"]],
            ]
        },
        // Kotlin ?
        // Lua ? config.lua ? init.lua ?
        {
            name: "Nim package", steps: [
                [normalDirectories, includesAll, ["src", "tests"]],
                [fileExtensions, includes, [".nimble"]],
            ]
        },
        // Node ?
        // OCaml ?
        // Odin ?
        // Perl ?
        {
            name: "Perl CPAN module", steps: [
                [normalDirectories, includes, ["t"]],
                [normalFiles, includes, ["Makefile.PL"]],
            ]
        },
        // PHP ?
        {
            name: "Python package", steps: [
                [normalFiles, includes, ["__init__.py"]],
            ]
        }, {
            name: "Racket package", steps: [
                [normalFiles, includes, ["info.rkt"]],
            ]
        },
        // React ? React Native ?
        {
            name: "React Native project", steps: [
                [normalDirectories, includesAll, ["ios", "android"]],
                [normalFiles, includesAll, ["index.js", "App.js"]]
            ]
        },
        {
            name: "Retro Virtual Machine", steps: [
                [normalDirectories, includes, ["snap"]],
                [normalFiles, includes, ["machine"]]
            ]
        },
        // Ruby ? Ruby on Rails?
        {
            name: "Rust project", steps: [
                [normalFiles, includesAll, ["Cargo.lock", "Cargo.toml"]],
                [normalDirectories, includesAll, ["src"/*, "target"*/]],
            ]
        }, {
            name: "Scala project", steps: [
                [normalFiles, includes, ["build.sbt"]],
                [normalDirectories, includesAll, [/*"lib", */"project", "src", "target"]],
            ]
        }, {
            name: "Typescript project", steps: [
                [normalFiles, includes, ["tsconfig.json"]],
                [fileExtensions, includes, [".ts"]],
            ]
        }, {
            name: "Visual Studio project", steps: [
                [dotDirectories, includes, [".vs"]],
                [fileExtensions, includes, [".sln"]],
            ]
        }, {
            name: "Xcode project", steps: [
                [dirExtensions, includes, [".xcodeproj"]],
            ]
        }, {
            name: "Zig project", steps: [
                [normalDirectories, includesAll, ["src", "zig-cache", "zig-out"]],
                [normalFiles, includes, ["build.zig"]],
            ]
        }
    ]

    let answers: string[] = []
    table.forEach(entry => {
        if (entry.steps.every(s => {
            const [haystack, check, needles] = s;
            
            return check(haystack, needles)
        })) {
            answers.push(entry.name)
        }
    })

    return answers
}

function checkForCollections(fileextObj: extensionObject, fileExtensions: string[]): string | undefined {
    const audioexts = [".mp3", ".mp4", ".m4a", ".ogg", ".ram", ".wav"]              // TODO mp4 can also be video
    const jpegexts = [".jpeg", ".jpg"]
    const otherimgexts = [".gif", ".png", ".svg", ".tiff", ".webp"]                 // TODO webp can also be audio
    const videxts = [".mov", ".mp4", ".webp"]                                       // TODO mp4 can also be audio
    const jsexts = [".cjs", ".coffee", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]
    const plexts = [".pod", ".pl", ".pm"]
    const wordexts = [".doc", ".docx"]
    const excelexts = [".xls", ".xlsx"]

    const extensions = [
        { name: "audio", exts: audioexts },
        { name: "jpeg", exts: jpegexts },
        { name: "image", exts: [...jpegexts, ...otherimgexts] },
        { name: "video", exts: videxts },
        { name: "media", exts: [...jpegexts, ...otherimgexts, ...audioexts, ...videxts] },
        { name: "web", exts: [".css", ".htm", ".html", ".js"] },
        { name: "C source", exts: [".c", ".h"] },
        { name: "C++ source", exts: [".cpp", ".hpp"] },
        { name: "archive", exts: [".bz2", ".gz", ".xz", ".zip"] },
        { name: "Perl script", exts: plexts },
        { name: "JavaScript/ECMAScript/CoffeeScript/TypeScript", exts: jsexts },
        { name: "script", exts: [...jsexts, ...plexts, ".lua", ".php", ".py", ".sh"] },
        { name: "MS Word", exts: wordexts },
        { name: "word processor", exts: [...wordexts, ".odt"] },
        { name: "Excel", exts: excelexts },
        { name: "spreadsheet", exts: [...excelexts, ".ods"] },
        { name: "MS Office", exts: [...wordexts, ...excelexts] },
        { name: "LibreOffice", exts: [".odt", ".ods"] },
        { name: "office", exts: [...wordexts, ...excelexts, ".odt", ".ods"] },
    ]

    // All files have the same extension (if there's more than just one file)
    const fileExtensionsInThisDir = Object.keys(fileextObj)

    let result: string | undefined

    // all files have the same extensions
    if (fileExtensionsInThisDir.length == 1) {
        const onlykey = fileExtensionsInThisDir[0]
        const numkeys = fileextObj[onlykey]
        if (numkeys > 1) {
            result = `a collection of ${numkeys} ${onlykey} files`
        }
    }

    // all files have extensions for file formats of the same class (all images, all audio, etc.)
    else if (fileExtensionsInThisDir.length > 0) {
        extensions.some(e => {
            if (fileExtensionsInThisDir.every(v => e.exts.includes(v))) {
                result = `a collection of ${fileExtensions.length} ${e.name} files`
                return true
            }
            return false
        })
    }

    return result
}

function countArrayFieldsToObject(array: string[], foldcase:boolean): extensionObject {
    return array.reduce<extensionObject>((obj, str) => {
        const lcs = foldcase ? str.toLowerCase() : str
        obj[lcs] = lcs in obj ? obj[lcs] + 1 : 1
        return obj
    }, {})
}

function countObToString(ob: extensionObject): string {
    return Object.keys(ob).sort((a, b) => ob[b] - ob[a] || a.localeCompare(b)).map(k => `${k}: ${ob[k]}`).join(", ")
}

function verboseSummary(depth: number, collections: [collection, string][]) {
    collections.forEach(coll => {
        let name: string = coll[1], len: number, str: string = ""
        if (Array.isArray(coll[0])) {
            len = coll[0].length
            if (len) {
                let arr = coll[0]
                if (typeof coll[0][0] !== "string") {
                    arr = arr.map(d => (d as DirentStat).name)
                }
                //if (coll[0] === normalDirectories)
                //    str = arr.join('\n')
                //else
                str = arr.join(", ")
            }
        } else {
            len = Object.keys(coll[0]).length
            str = countObToString(coll[0])
        }
        len && printText(depth + 2, `${name}: ${str}`)
    })
}

async function processFilename(depth: number, filename: string) {
    try {
        const s = await fsp.lstat(filename)

        if (s.isDirectory()) {
            const direntstats = await readdirAndStat(filename, depth)
            await processDirents(depth, filename, direntstats)
        } else if (s.isFile()) {
            printEntry(depth, filename);
            printAnswer(depth, "file")

        } else {
            printEntry(depth, filename);
            printAnswer(depth, "neither file nor directory")
        }
    } catch (ex: any) {
        const err = ex as NodeJS.ErrnoException
        printEntry(depth, filename);
        if (err.code === "ENOENT") {
            printError(depth, "no such file: " + filename)
        } else {
            printError(depth, "err: " + err.code)
        }
    }
}

async function readdirAndStat(filename: string, depth: number): Promise<DirentStat[]> {
    try {
        const veryRawDirents = await fsp.readdir(filename, { withFileTypes: true })

        // Node and Bun get readdir results in different orders
        let rawDirents = veryRawDirents.sort((a, b) => a.name.localeCompare(b.name))

        return Promise.all(rawDirents.map(async dirent => {
            try {
                let ds: DirentStat = {
                    isFile: () => dirent.isFile(),
                    isDirectory: () => dirent.isDirectory(),
                    name: dirent.name,
                }

                if (dirent.isFile())
                    ds.size = (await fsp.lstat(path.join(filename, dirent.name))).size

                return ds
            } catch (ex) {
                return {
                    isFile: () => false,
                    isDirectory: () => false,
                    name: dirent.name,
                    statError: (ex as NodeJS.ErrnoException).code,
                }
            }
        }))
    } catch (ex) { throw ex }
}
