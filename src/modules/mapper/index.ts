/**
 * Mapper module — the App Mapper application: a project's Markdown files as nodes on the
 * canvas, edited in MD Editor windows, with NeXT-style controls from the widgets module.
 *
 * Other modules import from here only, never from files inside this folder.
 */
import './mapper.css';

export { MapperApp } from './app';
export { parseDoc, addDependency, removeDependency, setDependencyLabel, type DocInfo, type DocDependency } from './docs';
