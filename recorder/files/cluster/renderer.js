'use strict';
var Output=require('./rgba-output').Output,rgba=require('./atlas-rgba');
function Renderer(createClient,events,clock){Output.call(this,createClient,events,clock);}
require('util').inherits(Renderer,Output);
Renderer.prototype.paint=function(generation,packet,layer,view){if(!this.cr||generation!==this.generation||!this.shown)return false;var image=rgba.convert(packet,layer,view);image.id=packet.readUInt32LE(9)+packet.readUInt32LE(13)*4294967296;return this.pacer.enqueue(generation,image);};
module.exports={Renderer:Renderer};
