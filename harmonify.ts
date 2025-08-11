// ---------------- Imports ---------------- //

import * as acorn from 'acorn';
import * as astring from 'astring';

// ---------------- Enums & Interfaces ---------------- //

export enum InsertType {
	BEFORE_TARGET = 'before',
	AFTER_TARGET = 'after'
}

export enum FlowControl {
	CONTINUE_EXEC = 'continue',
	CONTINUE_WITHOUT_POSTFIX = 'continue_without_postfix',
	STOP_EXEC = 'stop'
}

export type AnyFunction = (...args: any[]) => any;

export interface Patch {
	prefix?: AnyFunction | null;
	postfix?: AnyFunction | null;
	replace?: AnyFunction | null;
	id: string;
	metadata: Record<string, any>;
	allowUnsafeInjection: boolean;
}

export interface PatchRecord {
	id: string;
	timestamp: number;
	patch: Patch;
	original: AnyFunction;
}

export interface InjectRecord {
	id: string;
	timestamp: number;
	original: AnyFunction;
	spec: InjectionSpec
}

export interface InjectionSpec {
	code: string;
	line: number;
	loc: InjectLocation;
}

export type InjectLocation = 'before' | 'after'



// ---------------- Internal States ---------------- //

// For keeping track of patches & injections
const patches = new Map<string, PatchRecord>();
const injects = new Map<string, InjectRecord>();

// For keeping track of inject attributes
const functionMeta = new WeakMap<AnyFunction, { allowInject?: boolean }>();

function getNewID(prefix: string = 'patch') {
	return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}



// ---------------- Helper Functions ---------------- //

function isFunction(value: any): value is AnyFunction {
	return typeof value === 'function';
}

function ensureObject(obj: any, name?: string) {
	if (obj == null || obj == undefined)
		if (name)
			throw new Error(`Target object '${name}' cannot be null or undefined`)
		else
			throw new Error('Target object cannot be null or undefined')
}

/**
 * Mark a function as not allowing injections. <br>
 * @param target The function which is to be marked.
 */
export function noInject<T extends AnyFunction>(target: T): T {
	functionMeta.set(target, { allowInject: false });
	return target;
}

/**
 * Explicitly mark a function as allowing injections. <br>
 * @param target The function which is to be marked.
 */
export function allowInject<T extends AnyFunction>(target: T): T {
	functionMeta.set(target, { allowInject: true });
	return target;
}

/**
 * Get the `allowInject` flag for a callable.
 * @param target The target function for the query.
 * 
 * @returns the value of the `allowInject` flag for the function, or `undefined` if the function doesn't exist.
 * * Returns `true` if the function hasn't been explicitly marked.
 */
export function getInjectFlag<T extends AnyFunction>(target: T): boolean | undefined {
	if (!target) return undefined;
	const target_meta = functionMeta.get(target);
	return target_meta ? target_meta.allowInject : true;
}



// ---------------- Core API ---------------- //

/**
 * Patches a function property on a target object/module.
 * @param {object} targetObject The object that holds the function propery.
 * @param {string | symbol} functionName The name of the function.
 * @param {Patch} patch The patch that is to be applied.
 * 
 * @returns {string} the ID of the patch.
 */
export function patchFunction(targetObject: object, functionName: string | symbol, patch: Patch) {
	ensureObject(targetObject, 'targetObject');
	ensureObject(functionName, 'functionName');
	ensureObject(patch, 'patch');   // Make sure the patch isn't `null`

	let originalFunction: AnyFunction | null = (targetObject as any)[functionName];
	if (!isFunction(originalFunction))
		throw new Error(`targetObject[${String(functionName)}] is not a function -- actual type is ${typeof originalFunction}`)

	const patchID = patch.id ?? getNewID('fn');

	// Create the wrapped function
	const wrapperFunction: AnyFunction = function (thisObject: any, ...args: any[]): any {
		let flow: string = FlowControl.CONTINUE_EXEC;
		let patch_args: any[] = args;

		if (patch.replace) {
			return patch.replace.apply(thisObject, args);
		}
		else {
			// Run the prefix hook
			if (patch.prefix) {
				try {
					let result;
					[result, patch_args, flow] = patch.prefix.apply(thisObject, patch_args);
					if (flow === FlowControl.STOP_EXEC) return result;
				} catch (err) {
					console.warn(`[HarmonifyJS:${patchID}] 'prefix' hook threw error: ${err}`)
				}
			}

			let callResult: any = originalFunction.apply(thisObject, patch_args);

			if (patch.postfix) {
				try {
					return patch.postfix.apply(thisObject, [callResult, ...patch_args]); // Add the call result to the start of the argument list
				} catch (err) {
					console.warn(`[HarmonifyJS:${patchID}] 'postfix hook threw error: {err}`);
				}
			}

			return callResult;
		}
	}

	// Apply the wrapped function
	Object.defineProperty(wrapperFunction, 'name', {
		value: (originalFunction as any).name || String(functionName),
		configurable: true
	})
	(wrapperFunction as any).__original = originalFunction;
	try {
		(targetObject as any)[functionName] = wrapperFunction;
	} catch (err) {
		throw new Error(`failed to assign patched function to target[${String(functionName)}]: ${err}`);
	}

	// Create a patch record and store it
	const record: PatchRecord = {
		id: patchID,
		patch: patch,
		timestamp: Date.now(),
		original: originalFunction
	}
	patches.set(patchID, record);
	return patchID;
}



// ---------------- AST Helpers ---------------- //

function parseFunctionToNode(src: string): any {
	const wrappedFunc = `(${src})`;
	const ast = acorn.parse(wrappedFunc, { ecmaVersion: 'latest', locations: true }) as any;
	const expr = ast.body && ast.body[0] && ast.body[0].expression;
	if (!expr) throw new Error('unable to parse function source to AST expression');
	return { ast: expr, fullAst: ast };
}

function parseCodeBlockToStatements(code: string) {
  const wrapped = `{ ${code} }`;
  const ast = acorn.parse(wrapped, { ecmaVersion: 'latest', locations: true }) as any;
  const stmts = ast.body[0].body.body;
  return stmts || [];
}

// ---------------- Injector API ---------------- //

/**
 * Injcets code into a function property of an object/module.
 * 
 * @param {object} targetObject The object that holds the function property.
 * @param {string | symbol} functionName The name of the function.
 * @param {InjectionSpec} injectSpec The specification of the current injection.
 * @returns {string} the ID of the injection.
 */
export function injectFunction(targetObject: object, functionName: string | symbol, injectSpec: InjectionSpec): string {
	ensureObject(targetObject, 'targetObject');
	ensureObject(functionName, 'functionName');
	ensureObject(injectSpec, 'injectSpec');

	const originalFunction: AnyFunction = (targetObject as any)[functionName];
	if (!isFunction(originalFunction)) throw new Error(`targetObject.${String(functionName)} is not a function`);

	const originalInjectFlag = getInjectFlag(originalFunction);
	if (!originalInjectFlag) {
		throw new Error(`Function ${String(functionName)} has prohibited injection via the 'noInject' attribute`)
	}

	const injectID = getNewID('inj');

	// Get the AST for the function using Acorn
	const source = originalFunction.toString();
	const { ast: fnNode } = parseFunctionToNode(source);

	// Check if the function node's body is editable
	if (!fnNode.body || !Array.isArray(fnNode.body.body)) {
		throw new Error('Cannot inject into a function without a block body (arrow/expression functions ar not supported)');
	}

	// Parse the target input
	const statements = fnNode.body.body;
	const injectStatements = parseCodeBlockToStatements(injectSpec.code);

	ensureObject(injectSpec.line, 'injectSpec.line');
	ensureObject(injectSpec.loc, 'injectSpec.loc');

	// Find the statement whose line == injectSpec.line
	let index = -1;
	for (let i = 0; i < statements.length; i++) {
		const s = statements[i];
		if (s.loc && s.loc.end && s.loc.end.line === injectSpec.line) {
			index = i;
			break;
		}
		if (s.loc && s.loc.start && s.loc.start.line <= injectSpec.line && s.loc.end && s.loc.end.line >= injectSpec.line) {
			// line falls inside this statement; choose to insert after it
			index = i;
			break;
		}
		if (s.loc && s.loc.start && s.loc.start.line > injectSpec.line) {
			// passed the line without finding exact; insert before this
			index = i - 1;
			break;
		}
	}
	if (index === -1) {
		// default to appending
		statements.push(...injectStatements);
    } else {
		statements.splice(index + 1, 0, ...injectStatements);
    }

	// Re-generate the function code for the modified function node
	const newFunctionSource = astring.generate(fnNode);
	// Create the executable function from the source
	const newFunction = eval(`${newFunctionSource}`);

	// Assign the new function
	(targetObject as any)[functionName] = newFunction;

	// Create an inject record
	const record: InjectRecord = {
		id: injectID,
		timestamp: Date.now(),
		original: originalFunction,
		spec: injectSpec
	};

	injects.set(injectID, record);
	return injectID;
}
