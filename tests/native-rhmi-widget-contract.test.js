"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
// Verified against live ID7 resources on 2026-11-17: CheckBox in installed
// apps, DropDownMenu in OEM apps, and the running Store's progress bar.
// SDK component types and OEM widget templates must agree or RHMI init fails.
const supported = {
  checkBox: new Set(["LT_CheckBox_1Row"]),
  dropDownMenu: new Set(["LT_DropDownMenu_1Row_2Col3070"]),
  progressBar: new Set([undefined]),
};
test("native checkbox, dropdown and progress controls use type-compatible live ID7 templates", () => {
  const xml = fs.readFileSync(
    path.join(
      __dirname,
      "../idrive/rhmiData/uiDescriptions/ID7/application.xml",
    ),
    "utf8",
  );
  let checked = 0;
  for (const match of xml.matchAll(/<component\s+([^>]+)>/g)) {
    const attrs = {};
    for (const a of match[1].matchAll(/([A-Za-z]+)="([^"]*)"/g))
      attrs[a[1]] = a[2];
    if (!supported[attrs.type]) continue;
    checked++;
    assert.ok(
      supported[attrs.type].has(attrs.widget),
      `component ${attrs.id}: ${attrs.widget} is not a validated ${attrs.type} template`,
    );
  }
  assert.ok(checked >= 10, "all new native control types must be covered");
});
test("native title components have text rows without unsupported visibility or focus properties", () => {
  const data = require("../idrive/rhmiData/uiDescriptions/ID7/uiDescription.json");
  let count = 0;
  for (const state of Object.values(data.containers))
    for (const c of Object.values(state.components || {}))
      if (c.type === "title") {
        count++;
        assert.deepEqual(
          c.properties || {},
          {},
          c.name + " has unsupported title properties",
        );
      }
  assert.equal(count, 7);
  const xml = fs.readFileSync(
    path.join(
      __dirname,
      "../idrive/rhmiData/uiDescriptions/ID7/application.xml",
    ),
    "utf8",
  );
  for (const m of xml.matchAll(
    /<component\b([^>]*?)\/>|<component\b([^>]*?)>([\s\S]*?)<\/component>/g,
  )) {
    const attrs = m[1] || m[2];
    if (/\btype="title"/.test(attrs))
      assert.doesNotMatch(
        m[3] || "",
        /<property\b/,
        "Native title XML cannot carry visibility/focus properties",
      );
  }
});
test("native dropdowns declare HeaderText and ItemText instead of the unsupported Text row model", () => {
  const data = require("../idrive/rhmiData/uiDescriptions/ID7/uiDescription.json");
  let count = 0;
  for (const state of Object.values(data.containers))
    for (const c of Object.values(state.components || {}))
      if (c.type === "dropDownMenu") {
        count++;
        assert.ok(c.cells && c.cells.HeaderText, c.name + " needs HeaderText");
        for (const row of c.rows) {
          assert.ok(row.ItemText, c.name + " needs ItemText");
          assert.equal(
            row.Text,
            undefined,
            c.name + " cannot send a Text row model",
          );
        }
      }
  assert.equal(count, 2);
});
test("native backup and drive screens belong to the home entry navigation tree", () => {
  const data = require("../idrive/rhmiData/uiDescriptions/ID7/uiDescription.json");
  const xml = fs.readFileSync(path.join(__dirname,"../idrive/rhmiData/uiDescriptions/ID7/application.xml"),"utf8");
  for (const [id,parent] of [[200,1],[300,200],[400,700],[500,1],[600,1],[700,1]]) {
    assert.deepEqual(data.containers[id].properties.ParentState,{value:parent,type:"UInt"});
    const body = xml.match(new RegExp('<container id="'+id+'"[^>]*>([\\s\\S]*?)</container>'))[1];
    assert.match(body,new RegExp('<property id="9" value="'+parent+'"\\s*/>'));
  }
});
test("drive progress uses the validated SDK default instead of an offset media template",()=>{
 const xml=fs.readFileSync(path.join(__dirname,"../idrive/rhmiData/uiDescriptions/ID7/application.xml"),"utf8");
 const bars=[...xml.matchAll(/<component[^>]*type="progressBar"[^>]*>/g)];assert.equal(bars.length,5);
 for(const [bar] of bars)assert.doesNotMatch(bar,/widget=/);
});
test("single-line drive headings do not reserve three native rows above their progress bar",()=>{
 const xml=fs.readFileSync(path.join(__dirname,"../idrive/rhmiData/uiDescriptions/ID7/application.xml"),"utf8");
 for(const id of [218,220,222,224,226])assert.match(xml,new RegExp('<component id="'+id+'" type="button" widget="LT_Button_1Row"'));
});
test("pending upload drive rows are focusable native buttons for rotary scrolling",()=>{
 const d=require('../idrive/rhmiData/uiDescriptions/ID7/uiDescription.json');const xml=fs.readFileSync(path.join(__dirname,'../idrive/rhmiData/uiDescriptions/ID7/application.xml'),'utf8');
 for(const id of [218,220,222,224,226]){const c=d.containers[200].components[id];assert.equal(c.type,'button');assert.equal(c.properties.Focusable.value,3);assert.match(xml,new RegExp('<component id="'+id+'" type="button" widget="LT_Button_1Row"'));
 }
});
test('every Remote Backup option is immediately followed by its own native helper label',()=>{
 const d=require('../idrive/rhmiData/uiDescriptions/ID7/uiDescription.json'),xml=fs.readFileSync(path.join(__dirname,'../idrive/rhmiData/uiDescriptions/ID7/application.xml'),'utf8'),state=xml.match(/<container id="200"[^>]*>([\s\S]*?)<\/container>/)[1];
 const ids=[...state.matchAll(/<component id="(\d+)"/g)].map(m=>Number(m[1]));
 for(const [option,hint,name] of [[214,216,'BACKUP_AUTO_HINT'],[215,242,'BACKUP_PAUSE_HINT'],[241,243,'BACKUP_STATIONARY_HINT'],[237,244,'BACKUP_LOCKED_HINT']]){
  assert.equal(ids[ids.indexOf(option)+1],hint,'helper must sit immediately below option '+option);
  const c=d.containers[200].components[hint];assert.equal(c.type,'label');assert.equal(c.name,name);assert.equal(c.properties.Focusable.value,0);assert.equal(c.properties.Visible.value,1);
  assert.match(state,new RegExp('<component id="'+hint+'" type="label" widget="LT_Label_3Row_1TextDyn"'));
  assert(c.rows[0].Text.value.length>20,'helper has usable static text before app render');
 }
 assert.equal(Object.values(d.containers[200].components).some(c=>c.name==='BACKUP_HINT'),false);
});
