
// Copyright 2012 Google Inc. All rights reserved.
 
 (function(w,g){w[g]=w[g]||{};
 w[g].e=function(s){return eval(s);};})(window,'google_tag_manager');
 
(function(){

var data = {
 "resource": {
  "version": "264",
  "macros": [
   {
    "function": "__smm",
    "vtp_setDefaultValue": true,
    "vtp_input": [
     "macro",
     1
    ],
    "vtp_defaultValue": "G-YBFC8BJZW8",
    "vtp_map": [
     "list",
     [
      "map",
      "key",
      "www.mozilla.org",
      "value",
      "G-MQ7767QQQW"
     ],
     [
      "map",
      "key",
      "www.allizom.org",
      "value",
      "G-YBFC8BJZW8"
     ],
     [
      "map",
      "key",
      "www-dev.allizom.org",
      "value",
      "G-SLZPCL53DQ"
     ]
    ]
   },
   {
    "function": "__smm",
    "vtp_setDefaultValue": false,
    "vtp_input": [
     "macro",
     1
    ],
    "vtp_map": [
     "list",
     [
      "map",
      "key",
      "www-dev.allizom.org",
      "value",
      "G-XMR6B2WM5E"
     ],
     [
      "map",
      "key",
      "www.allizom.org",
      "value",
      "G-R74PYCVR6D"
     ],
     [
      "map",
      "key",
      "www.mozilla.org",
      "value",
      "G-9Y966W6Q7W"
     ]
    ]
   }
  ],
  "tags": [],
  "predicates": [],
  "rules": []
 }
};
;



var l,aa=typeof Object.create=="function"?Object.create:function(a){var b=function(){};b.prototype=a;return new b},ba=typeof Object.defineProperties=="function"?Object.defineProperty:function(a,b,c){if(a==Array.prototype||a==Object.prototype)return a;a[b]=c.value;return a},ca=function(a){for(var b=["object"==typeof globalThis&&globalThis,a,"object"==typeof window&&window,"object"==typeof self&&self,"object"==typeof global&&global],c=0;c<b.length;++c){var d=b[c];if(d&&d.Math==Math)return d}throw Error("Cannot find global object");
},da=ca(this),ea=typeof Symbol==="function"&&typeof Symbol("x")==="symbol",ja={},ka={},la=function(a,b,c){if(!c||a!=null){var d=ka[b];if(d==null)return a[b];var e=a[d];return e!==void 0?e:a[b]}},ma=function(a,b,c){if(b)a:{var d=a.split("."),e=d.length===1,f=d[0],g;!e&&f in ja?g=ja:g=da;for(var h=0;h<d.length-1;h++){var k=d[h];if(!(k in g))break a;g=g[k]}var m=d[d.length-1],p=ea&&c==="es6"?g[m]:null,q=b(p);if(q!=null)if(e)ba(ja,m,{configurable:!0,writable:!0,value:q});else if(q!==p){if(ka[m]===void 0){var r=
Math.random()*1E9>>>0;ka[m]=ea?da.Symbol(m):"$jscp$"+r+"$"+m}ba(g,ka[m],{configurable:!0,writable:!0,value:q})}}},na;if(ea&&typeof Object.setPrototypeOf=="function")na=Object.setPrototypeOf;else{var oa;a:{var qa={a:!0},ra={};try{ra.__proto__=qa;oa=ra.a;break a}catch(a){}oa=!1}na=oa?function(a,b){a.__proto__=b;if(a.__proto__!==b)throw new TypeError(a+" is not extensible");return a}:null}
var sa=na,ta=function(a,b){a.prototype=aa(b.prototype);a
// Ajout pour le test : un identifiant dans le code du moteur ne doit pas être repris.
var zz="G-ENGINE1234";
