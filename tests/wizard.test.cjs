const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const start = html.indexOf("  function render(){", html.indexOf("const box=$(\"hlQuestions\")"));
const end = html.indexOf("  function showPage(", start);
const renderCode = html.slice(start, end);

test("rerendering setup preserves the class size input and its value", () => {
  class Element {
    constructor() {
      this.children = [];
      this.parent = null;
      this.style = {};
      this.dataset = {};
    }
    appendChild(child) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      this.children.push(child);
      child.parent = this;
    }
    contains(child) {
      return this.children.some(item => item === child || item.contains(child));
    }
    before(child) { this.parent.appendChild(child); }
    set innerHTML(value) {
      for (const child of this.children) child.parent = null;
      this.children = [];
      if (value) {
        this.label = new Element();
        this.valueElement = new Element();
        this.arrows = [new Element(), new Element()];
        this.arrows.forEach((arrow, index) => { arrow.dataset.d = index ? "-1" : "1"; });
        [this.label, this.valueElement, ...this.arrows].forEach(child => this.appendChild(child));
      }
    }
    querySelector(selector) { return selector === ".hl-q-label" ? this.label : this.valueElement; }
    querySelectorAll() { return this.arrows; }
    addEventListener() {}
  }
  const root = new Element(), box = new Element(), home = new Element();
  const input = new Element(), plus = new Element(), next = new Element();
  input.value = "73";
  root.appendChild(box);
  root.appendChild(home);
  home.appendChild(input);
  home.appendChild(plus);
  const elements = { classSize: input, classSizePlus: plus };
  const context = vm.createContext({
    box, next, revealed: 5,
    document: { createElement: () => new Element() },
    $: id => root.contains(elements[id]) ? elements[id] : null,
    order: () => [
      ...Array.from({ length: 4 }, () => ({ label: "Option", text: () => "Value" })),
      { label: "Class Size", input: true }
    ]
  });
  vm.runInContext(renderCode + "\nrender(); render();", context);
  assert.ok(root.contains(input));
  assert.ok(box.contains(input));
  assert.equal(input.value, "73");
});

test("export validation identifies null, non-finite, missing and sparse values", () => {
  const start = html.indexOf("  function invalidExportValue(value, path)");
  const end = html.indexOf("  const invalidPath =", start);
  const validate = vm.runInNewContext(html.slice(start, end) + "\ninvalidExportValue");
  assert.equal(validate({ players: [{ attributes: [2, 3] }] }, "class"), "");
  assert.equal(validate({ player: { height: null } }, "class"), "class.player.height");
  assert.equal(validate({ attr: [NaN] }, "class"), "class.attr.0");
  assert.equal(validate({ attr: [undefined] }, "class"), "class.attr.0");
  assert.equal(validate({ attr: new Array(1) }, "class"), "class.attr.0");
});

test("loading trivia always shows its answer immediately after the question", () => {
  const start = html.indexOf("  function createLoadingMessages(){");
  const end = html.indexOf('  $("hlSubmit").addEventListener', start);
  const create = vm.runInNewContext(html.slice(start, end) + "\ncreateLoadingMessages");
  const next = create();
  const messages = Array.from({ length: 40 }, () => next());
  const question = "What team does Polan Stronk play for?";
  const answer = "Answer: LA Stars.";
  assert.ok(messages.includes(question));
  assert.ok(messages.includes("Giving KoalityGame a back rub..."));
  assert.ok(messages.includes("Browsing Hoop Land Discord..."));
  messages.forEach((message, index) => {
    if (message === question && index + 1 < messages.length) assert.equal(messages[index + 1], answer);
    if (message === answer && index > 0) assert.equal(messages[index - 1], question);
  });
});
