export class ParseError extends Error {
  constructor(message, { selector, html } = {}) {
    super(message)
    this.name = 'ParseError'
    this.selector = selector
    this.htmlSnippet = html?.slice(0, 200)
  }
}
