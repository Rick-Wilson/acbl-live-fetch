import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  findExportMenu,
  injectDealMenuItem,
  grabHandviewerShortlink,
  DEAL_MENU_ITEM_ID,
} from '../../src/ui/bboLobbyContent.js'

// BBO reuses one `.menuClass` container and swaps its children, so the class
// alone can't distinguish the top-level menu from the Export submenu. Both
// shapes are reproduced here, including the `_ngcontent-*` attributes Angular's
// scoped styles key off.
function menu(labels) {
  document.body.innerHTML = `
    <div class="coverClass"><menu><div class="menuClass">
      ${labels.map((l) => `
        <menu-item _ngcontent-hem-c127="" _nghost-hem-c39="" class="ng-star-inserted">
          <div _ngcontent-hem-c39="" style="background-color: rgb(191, 214, 153); padding: 5px;">${l}</div>
        </menu-item>`).join('')}
    </div></menu></div>`
  return document.querySelector('.menuClass')
}

const TOP_LEVEL = ['Pictures of cards', 'Advance card by card', 'Show double dummy', 'Export']
const EXPORT = ['Send to member', 'Send robot report', 'Send abuse report', 'Save deal as', 'Handviewer link', 'Hand editor']

// jsdom gives every element a null offsetParent, which the real code uses as its
// visibility test. Make it report what a rendered menu would.
beforeEach(() => {
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return this.isConnected ? document.body : null },
  })
})

describe('findExportMenu', () => {
  it('ignores the top-level menu', () => {
    menu(TOP_LEVEL)
    expect(findExportMenu(document)).toBeNull()
  })

  it('finds the submenu by its contents, not its class', () => {
    const m = menu(EXPORT)
    expect(findExportMenu(document)).toBe(m)
  })
})

describe('injectDealMenuItem', () => {
  it('appends a seventh item that looks like BBO\'s own', () => {
    const m = menu(EXPORT)
    const item = injectDealMenuItem(document, vi.fn())

    expect(m.children).toHaveLength(7)
    expect(m.lastElementChild).toBe(item)
    expect(item.textContent.trim()).toBe('Bridge Classroom')
    // Cloned, so Angular's style-scoping attributes and inline styling come too.
    expect(item.hasAttribute('_nghost-hem-c39')).toBe(true)
    expect(item.querySelector('div').getAttribute('style'))
      .toBe(m.children[0].querySelector('div').getAttribute('style'))
  })

  it('does nothing on the top-level menu', () => {
    const m = menu(TOP_LEVEL)
    expect(injectDealMenuItem(document, vi.fn())).toBeNull()
    expect(m.children).toHaveLength(4)
  })

  it('is idempotent across repeated observer firings', () => {
    const m = menu(EXPORT)
    injectDealMenuItem(document, vi.fn())
    injectDealMenuItem(document, vi.fn())
    expect(m.querySelectorAll(`#${DEAL_MENU_ITEM_ID}`)).toHaveLength(1)
    expect(m.children).toHaveLength(7)
  })

  it('does not carry BBO\'s own click handler across the clone', () => {
    const m = menu(EXPORT)
    const spy = vi.fn()
    m.children[0].querySelector('div').addEventListener('click', spy)
    injectDealMenuItem(document, vi.fn())

    // Drop the item our handler looks for, so clicking ours fails immediately
    // instead of leaving an 8-second poll running into the next test — two
    // concurrent polls share this document and race for the same dialog.
    m.children[4].remove()

    document.getElementById(DEAL_MENU_ITEM_ID).querySelector('div').click()
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('grabHandviewerShortlink', () => {
  function openDialogOnClick(href, delayMs = 0) {
    const hv = [...document.querySelector('.menuClass').children]
      .find((i) => /handviewer link/i.test(i.textContent))
    hv.querySelector('div').addEventListener('click', () => {
      setTimeout(() => {
        const d = document.createElement('div')
        d.innerHTML = `<a href="${href}">${href}</a><button>Close</button>`
        // BBO's Close tears the dialog down; without that the "did we close it"
        // assertion would be testing the fixture rather than the code.
        d.querySelector('button').addEventListener('click', () => d.remove())
        document.body.appendChild(d)
      }, delayMs)
    })
  }

  it('clicks BBO\'s item, reads the link, and closes the dialog', async () => {
    menu(EXPORT)
    const url = 'https://tinyurl.bridgebase.com/4mv9fn9v'
    openDialogOnClick(url, 20)

    const got = await grabHandviewerShortlink(document, { timeoutMs: 2000 })
    expect(got).toBe(url)
    // The modal must not be left sitting over the app.
    expect(document.querySelector('a[href*="tinyurl"]')).toBeNull()
  })

  it('reports a renamed menu item rather than failing silently', async () => {
    menu(['Send to member', 'Save deal as', 'Hand editor'])
    await expect(grabHandviewerShortlink(document, { timeoutMs: 100 }))
      .rejects.toThrow(/Export menu closed/)
  })

  it('gives up with a message when no link appears', async () => {
    menu(EXPORT)
    await expect(grabHandviewerShortlink(document, { timeoutMs: 150 }))
      .rejects.toThrow(/didn't return a hand viewer link/)
  })
})
