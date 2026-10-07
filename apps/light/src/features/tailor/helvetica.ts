/**
 * The glyphs of the two PDF fonts every reader has built in — Helvetica and
 * Helvetica-Bold — with their widths (L-201).
 *
 * GENERATED DATA. Each row is [Unicode code point, PostScript glyph name,
 * width in Helvetica, width in Helvetica-Bold], widths in 1/1000 of the font
 * size. Taken from Adobe's Core 14 font metrics as pdf.js 6.2.108 carries them
 * (its `getMetrics` and `getGlyphsUnicode` tables in
 * `pdfjs-dist/legacy/build/pdf.worker.mjs`), sorted by code point. Adobe's AFM
 * files may be freely copied and distributed.
 *
 * WHY THESE TWO FONTS. A PDF reader must supply them itself, so the export
 * embeds no font file and the app stays light. They cover Latin-1 and most of
 * Latin Extended-A — é, ñ, ü, ł, ő, ș and the rest of the European names a UK
 * CV meets. Anything outside this list cannot be drawn by them; `pdf.ts`
 * says so rather than drop it quietly.
 */
export type HelveticaGlyph = readonly [
  codePoint: number,
  name: string,
  regular: number,
  bold: number,
];

// prettier-ignore
export const HELVETICA_GLYPHS: readonly HelveticaGlyph[] = [
  [32,'space',278,278], [33,'exclam',278,333], [34,'quotedbl',355,474], [35,'numbersign',556,556], [36,'dollar',556,556], [37,'percent',889,889],
  [38,'ampersand',667,722], [39,'quotesingle',191,238], [40,'parenleft',333,333], [41,'parenright',333,333], [42,'asterisk',389,389], [43,'plus',584,584],
  [44,'comma',278,278], [45,'hyphen',333,333], [46,'period',278,278], [47,'slash',278,278], [48,'zero',556,556], [49,'one',556,556],
  [50,'two',556,556], [51,'three',556,556], [52,'four',556,556], [53,'five',556,556], [54,'six',556,556], [55,'seven',556,556],
  [56,'eight',556,556], [57,'nine',556,556], [58,'colon',278,333], [59,'semicolon',278,333], [60,'less',584,584], [61,'equal',584,584],
  [62,'greater',584,584], [63,'question',556,611], [64,'at',1015,975], [65,'A',667,722], [66,'B',667,722], [67,'C',722,722],
  [68,'D',722,722], [69,'E',667,667], [70,'F',611,611], [71,'G',778,778], [72,'H',722,722], [73,'I',278,278],
  [74,'J',500,556], [75,'K',667,722], [76,'L',556,611], [77,'M',833,833], [78,'N',722,722], [79,'O',778,778],
  [80,'P',667,667], [81,'Q',778,778], [82,'R',722,722], [83,'S',667,667], [84,'T',611,611], [85,'U',722,722],
  [86,'V',667,667], [87,'W',944,944], [88,'X',667,667], [89,'Y',667,667], [90,'Z',611,611], [91,'bracketleft',278,333],
  [92,'backslash',278,278], [93,'bracketright',278,333], [94,'asciicircum',469,584], [95,'underscore',556,556], [96,'grave',333,333], [97,'a',556,556],
  [98,'b',556,611], [99,'c',500,556], [100,'d',556,611], [101,'e',556,556], [102,'f',278,333], [103,'g',556,611],
  [104,'h',556,611], [105,'i',222,278], [106,'j',222,278], [107,'k',500,556], [108,'l',222,278], [109,'m',833,889],
  [110,'n',556,611], [111,'o',556,611], [112,'p',556,611], [113,'q',556,611], [114,'r',333,389], [115,'s',500,556],
  [116,'t',278,333], [117,'u',556,611], [118,'v',500,556], [119,'w',722,778], [120,'x',500,556], [121,'y',500,556],
  [122,'z',500,500], [123,'braceleft',334,389], [124,'bar',260,280], [125,'braceright',334,389], [126,'asciitilde',584,584], [161,'exclamdown',333,333],
  [162,'cent',556,556], [163,'sterling',556,556], [164,'currency',556,556], [165,'yen',556,556], [166,'brokenbar',260,280], [167,'section',556,556],
  [168,'dieresis',333,333], [169,'copyright',737,737], [170,'ordfeminine',370,370], [171,'guillemotleft',556,556], [172,'logicalnot',584,584], [174,'registered',737,737],
  [175,'macron',333,333], [176,'degree',400,400], [177,'plusminus',584,584], [178,'twosuperior',333,333], [179,'threesuperior',333,333], [180,'acute',333,333],
  [181,'mu',556,611], [182,'paragraph',537,556], [183,'periodcentered',278,278], [184,'cedilla',333,333], [185,'onesuperior',333,333], [186,'ordmasculine',365,365],
  [187,'guillemotright',556,556], [188,'onequarter',834,834], [189,'onehalf',834,834], [190,'threequarters',834,834], [191,'questiondown',611,611], [192,'Agrave',667,722],
  [193,'Aacute',667,722], [194,'Acircumflex',667,722], [195,'Atilde',667,722], [196,'Adieresis',667,722], [197,'Aring',667,722], [198,'AE',1000,1000],
  [199,'Ccedilla',722,722], [200,'Egrave',667,667], [201,'Eacute',667,667], [202,'Ecircumflex',667,667], [203,'Edieresis',667,667], [204,'Igrave',278,278],
  [205,'Iacute',278,278], [206,'Icircumflex',278,278], [207,'Idieresis',278,278], [208,'Eth',722,722], [209,'Ntilde',722,722], [210,'Ograve',778,778],
  [211,'Oacute',778,778], [212,'Ocircumflex',778,778], [213,'Otilde',778,778], [214,'Odieresis',778,778], [215,'multiply',584,584], [216,'Oslash',778,778],
  [217,'Ugrave',722,722], [218,'Uacute',722,722], [219,'Ucircumflex',722,722], [220,'Udieresis',722,722], [221,'Yacute',667,667], [222,'Thorn',667,667],
  [223,'germandbls',611,611], [224,'agrave',556,556], [225,'aacute',556,556], [226,'acircumflex',556,556], [227,'atilde',556,556], [228,'adieresis',556,556],
  [229,'aring',556,556], [230,'ae',889,889], [231,'ccedilla',500,556], [232,'egrave',556,556], [233,'eacute',556,556], [234,'ecircumflex',556,556],
  [235,'edieresis',556,556], [236,'igrave',278,278], [237,'iacute',278,278], [238,'icircumflex',278,278], [239,'idieresis',278,278], [240,'eth',556,611],
  [241,'ntilde',556,611], [242,'ograve',556,611], [243,'oacute',556,611], [244,'ocircumflex',556,611], [245,'otilde',556,611], [246,'odieresis',556,611],
  [247,'divide',584,584], [248,'oslash',611,611], [249,'ugrave',556,611], [250,'uacute',556,611], [251,'ucircumflex',556,611], [252,'udieresis',556,611],
  [253,'yacute',500,556], [254,'thorn',556,611], [255,'ydieresis',500,556], [256,'Amacron',667,722], [257,'amacron',556,556], [258,'Abreve',667,722],
  [259,'abreve',556,556], [260,'Aogonek',667,722], [261,'aogonek',556,556], [262,'Cacute',722,722], [263,'cacute',500,556], [268,'Ccaron',722,722],
  [269,'ccaron',500,556], [270,'Dcaron',722,722], [271,'dcaron',643,743], [272,'Dcroat',722,722], [273,'dcroat',556,611], [274,'Emacron',667,667],
  [275,'emacron',556,556], [278,'Edotaccent',667,667], [279,'edotaccent',556,556], [280,'Eogonek',667,667], [281,'eogonek',556,556], [282,'Ecaron',667,667],
  [283,'ecaron',556,556], [286,'Gbreve',778,778], [287,'gbreve',556,611], [290,'Gcommaaccent',778,778], [291,'gcommaaccent',556,611], [298,'Imacron',278,278],
  [299,'imacron',278,278], [302,'Iogonek',278,278], [303,'iogonek',222,278], [304,'Idotaccent',278,278], [305,'dotlessi',278,278], [310,'Kcommaaccent',667,722],
  [311,'kcommaaccent',500,556], [313,'Lacute',556,611], [314,'lacute',222,278], [315,'Lcommaaccent',556,611], [316,'lcommaaccent',222,278], [317,'Lcaron',556,611],
  [318,'lcaron',299,400], [321,'Lslash',556,611], [322,'lslash',222,278], [323,'Nacute',722,722], [324,'nacute',556,611], [325,'Ncommaaccent',722,722],
  [326,'ncommaaccent',556,611], [327,'Ncaron',722,722], [328,'ncaron',556,611], [332,'Omacron',778,778], [333,'omacron',556,611], [336,'Ohungarumlaut',778,778],
  [337,'ohungarumlaut',556,611], [338,'OE',1000,1000], [339,'oe',944,944], [340,'Racute',722,722], [341,'racute',333,389], [342,'Rcommaaccent',722,722],
  [343,'rcommaaccent',333,389], [344,'Rcaron',722,722], [345,'rcaron',333,389], [346,'Sacute',667,667], [347,'sacute',500,556], [350,'Scedilla',667,667],
  [351,'scedilla',500,556], [352,'Scaron',667,667], [353,'scaron',500,556], [354,'Tcommaaccent',611,611], [355,'tcommaaccent',278,333], [356,'Tcaron',611,611],
  [357,'tcaron',317,389], [362,'Umacron',722,722], [363,'umacron',556,611], [366,'Uring',722,722], [367,'uring',556,611], [368,'Uhungarumlaut',722,722],
  [369,'uhungarumlaut',556,611], [370,'Uogonek',722,722], [371,'uogonek',556,611], [376,'Ydieresis',667,667], [377,'Zacute',611,611], [378,'zacute',500,500],
  [379,'Zdotaccent',611,611], [380,'zdotaccent',500,500], [381,'Zcaron',611,611], [382,'zcaron',500,500], [402,'florin',556,556], [536,'Scommaaccent',667,667],
  [537,'scommaaccent',500,556], [710,'circumflex',333,333], [711,'caron',333,333], [728,'breve',333,333], [729,'dotaccent',333,333], [730,'ring',333,333],
  [731,'ogonek',333,333], [732,'tilde',333,333], [733,'hungarumlaut',333,333], [8211,'endash',556,556], [8212,'emdash',1000,1000], [8216,'quoteleft',222,278],
  [8217,'quoteright',222,278], [8218,'quotesinglbase',222,278], [8220,'quotedblleft',333,500], [8221,'quotedblright',333,500], [8222,'quotedblbase',333,500], [8224,'dagger',556,556],
  [8225,'daggerdbl',556,556], [8226,'bullet',350,350], [8230,'ellipsis',1000,1000], [8240,'perthousand',1000,1000], [8249,'guilsinglleft',333,333], [8250,'guilsinglright',333,333],
  [8260,'fraction',167,167], [8364,'Euro',556,556], [8482,'trademark',1000,1000], [8706,'partialdiff',476,494], [8710,'Delta',612,612], [8721,'summation',600,600],
  [8722,'minus',584,584], [8730,'radical',453,549], [8800,'notequal',549,549], [8804,'lessequal',549,549], [8805,'greaterequal',549,549], [9674,'lozenge',471,494],
  [63171,'commaaccent',250,250], [64257,'fi',500,611], [64258,'fl',500,611],
];
