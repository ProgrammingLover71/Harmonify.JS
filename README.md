# Harmonify.JS

Harmonify.JS is a JavaScript/TypeScript port of the Harmonify library (pypi.org/projects/harmonify-patcher). Like its Pythonic cousin, it has the following use cases:
* **Debugging:** Inject logging or checks into methods without changing them permanently.
* **Testing:** Isolate parts of your code by temporarily changing how certain methods behave.
* **Extending Libraries:** Add new features or modify behavior of classes from libraries you can't edit directly.
* **Experimentation:** Play around with how code runs in a non-destructive way.

## Features

* **Prefix Patching:** Run your custom code *before* the original method executes.
* **Postfix Patching:** Run your custom code *after* the original method executes, even allowing you to modify its return value.
* **Replace Patching:** Completely swap out the original method's logic with your own.
* **Easy Unpatching:** Restore methods to their original state with a simple call.
* **Function Patching:** Patch functions as easily as methods!
* **Function and Method Hooking:** Use a *very* simple API to hook into any method (that is hookable)!
* **Code Injection:** Add you own code inside any JS/TS function or method and revert at any time.
  * *Note:* Be careful with code injection, and *do **not** inject code coming from a source you don't trust!* If you're a library developer and want to prevent your code from being injected into, use `noInject(<your function here>)` to prevent accidental and/or malicious injections. If you *want* your code to be injected into, you can also use the `allowInject(<your function here>)` for clarity.
* **Patch and Injection Undo-ing:** Undo patches and injections with a singe function call using a simple record-based system!

## Installation

Installing Harmonify is as easy as using `npm`:

```shell
npm install -g harmonify-js
```
After that, Harmonify.JS will be available globally!



## Example Programs

### Function Patching
#### my_library.ts
```typescript
// Example function
function getVersion(): string {
    return "1.0";
}
```

#### index.ts
```typescript
import * as Harmonify from 'harmonify-js';
import * as MyLibrary from './my_library';

let patch: Harmonify.Patch = {
    replace: function () {
        return "latest";
    }
};
Harmonify.patchFunction(MyLibrary, 'getVersion', patch);
```


### Code Injection
#### api_lib.ts
```typescript
import * as Harmonify from 'harmonify-js';

function openAPI1() {
    console.log('Doing API stuff...');
}

function openAPI2() {
    console.log('Doing even more API stuff...');
}

function restrictedAPI(uname: string, passwd: string) {
    console.log(`Logging in with uname=${uname}; passwd=${passwd}`);
    return getPass(uname) === passwd;
}

Harmonify.allowInject(openAPI2);
Harmonify.noInject(restrictedAPI);
```

#### main.ts
```typescript
import * as Harmonify from 'harmonify-js';
import * as APILib from 'api_lib';

// Inject Open API 1
Harmonify.injectFunction(APILib, 'openAPI1', {
    line: 1,
    loc: 'after',
    code: 'console.log("Hello!")'
});

// Inject Open API 2
Harmonify.injectFunction(APILib, 'openAPI2', {
    line: 1,
    loc: 'after',
    code: 'console.log("Hello!")'
});

// Inject Restriced API
Harmonify.injectFunction(APILib, 'restrictedAPI', {
    line: 1,
    loc: 'before',
    code: 'console.log(`Stealing data for ${uname} (pass = ${getPass(uname)})`)'
});
```