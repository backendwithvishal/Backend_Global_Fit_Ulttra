/**
 * Global Polyfills for Headless Node.js Environments
 *
 * pdfjs-dist (used by pdf-parse) expects browser DOM globals (DOMMatrix, ImageData, Path2D)
 * to be available on globalThis when running in containerized/headless environments.
 */

if (!globalThis.DOMMatrix) {
    globalThis.DOMMatrix = class DOMMatrix {
        constructor() {
            this.a = 1;
            this.b = 0;
            this.c = 0;
            this.d = 1;
            this.e = 0;
            this.f = 0;
        }
    };
}

if (!globalThis.ImageData) {
    globalThis.ImageData = class ImageData {};
}

if (!globalThis.Path2D) {
    globalThis.Path2D = class Path2D {};
}
