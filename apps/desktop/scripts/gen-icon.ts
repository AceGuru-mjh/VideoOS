// VideoOS 应用图标生成器 —— 零依赖（node:zlib PNG 编码）。
// v2 设计（issue #62）：像素猫吉祥物 —— 猫爪举起视频播放屏（琥珀播放三角）+
// 屏上 </> 代码括号；午夜蓝底 + 琥珀/奶油配色，呼应 midnight 主题与琥珀三角的旧品牌。
// 设计以 128×128 像素网格 + 64 色调色板编码于下方矩阵 —— 运行本脚本可逐字节复现
// build/icon.png（AI 辅助设计，矩阵化为唯一事实源，无需二进制资产）。
// 运行：bun apps/desktop/scripts/gen-icon.ts  → apps/desktop/build/icon.png
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 512;      // 输出尺寸（128 网格 × 4px/格）
const GRID = 128;      // 像素艺术网格
const SCALE = SIZE / GRID;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "build", "icon.png");

// ---- 调色板（64 色；'.' = 透明） ----
const PALETTE: string[] = [
  "#fdf4d7", "#fff1d4", "#fff1d1", "#fef1d1", "#fff1d0", "#fbf1d3", "#fff0d1", "#fff0d0",
  "#fdf0d0", "#f7f0d7", "#fcedd4", "#fef1cf", "#fceca6", "#f2d0c6", "#f7d77b", "#eec68f",
  "#f6c25d", "#fbbb5a", "#f8ab4c", "#e6b568", "#cbaf7b", "#cf8b6e", "#352b3c", "#08214a",
  "#08204c", "#081f47", "#072145", "#072049", "#072047", "#071f4d", "#071f4b", "#071f45",
  "#06224b", "#05204b", "#042046", "#571a30", "#2d1530", "#13132c", "#140d13", "#0b1c44",
  "#0b1528", "#0a0e25", "#090614", "#061e4a", "#041d4b", "#051d44", "#041841", "#041933",
  "#03163f", "#04132f", "#040a23", "#040310", "#011b42", "#02193a", "#01173b", "#01153a",
  "#010e2a", "#010c29", "#000c26", "#000c24", "#000a26", "#000820", "#000117", "#01010b",
];

// ---- 像素矩阵（128 行 × 128 列；字符 = 调色板索引，'.' = 透明） ----
const SPRITE: string[] = [
  "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmrt",
  "mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmrt",
  "mmmmmmrdbbllllllbbbbbelneeeeeebbbbbbbbbbbbbbbebbeebbbbbbbbbbbbbbbbbbbbbbbbbbbbllbbbbbbbbbbbbbbbbbbllbbbbbbbbbbbbbblebbbllkmmmmmm",
  "mmmmkkfZHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHZrmmmmmm",
  "mmqskngJJFFFEEEEEEEEEEEEEEEEEEFFEEEEEEFFFFFFEEFFEEEEFFEEEEEEEEFEEEEEEFEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEFcrsqqmm",
  "mmsqlcJlllllllllllllllllllllllllllllllkkkrkjlllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllGrqqqmm",
  "mmlknbIGHHHHHHHJHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHGGlmqrmm",
  "mmmKKbJrdPhhTTPPOUPPOOOOUUUOOOUUUOUUUOPPPPPPOOddPPhhUOOOOOPPOOUOOOPPOhUUOOOOUOUUPPddddPPOOOOOUUOdPUUddddOOUUddddddOOddPPrJkHcsmm",
  "mmrKKbJdhhhhhhhUUURRRRUhXXXXRRRRRRXXUUUUUUUUWWWXRRRRRRRRRRRRUURRRRRRRRRSSSSRRRRRRRRRRRUUXXRRUURRRRRRRRRRRRRRRRRRRRUUUUUUXJlGcmmm",
  "mmrKKbJdhhhhUUUUUURRRRUUXXXXRRRRRWWWUUUUUUUOWWWWNRRRRRRRRRRNOURRRRRRRRRRRRRRRRRNWWRWNRUOWWNNUURRRRRRRRRRRRRRRRRRRRUUUUUUXGlGcmmm",
  "mmrKKbJdhhhURRRRRRRRRRRRRRRRWWWRWWWWWWNNRRNNNNNNNNNRNRRRNNNNNNNNNNNNNNNRRRRRNNNNWWNNNRRNNNWWWWWWWWWWNNNNNRNNNNNRNRUUUUUUYGkGcsqq",
  "mmrKKbJdhUUURRRRRRRRRRRRRNWWWWWWWWWWRRRRRRRNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNWWNNRRRRRNWWWWWWWWWWNNNNNNNNNNNNNNUUUUUUQGiGcsqq",
  "mmrKKbJdRRRRRRRRRRRRRRRWWWWWWWWWWWWRTTTTXRNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNRXXXXXSNNNNNNNNNNNNNNNNNNNNNNNNWWUUUUYGiGcrqq",
  "mmrKKbJdRRRRRRRRRRRWRWWWWWWWWWWWWWRWlllllQNRRNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNRRlllllVNNNNNNNNNNNNNNNNNNNNNNNNWWUUUUYGiGcsqq",
  "mmrKKbJdRRRRRRRRRWWWWWWWWWNNWWWWNRPdpp//ptPTRRNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNWPPdp+//pjNXWWWWNNNNNNNNNNNNNNNNNNNNWXUUYEkGcmqq",
  "mkrKKbJdRRRRRNNNWWWWWWWWWWNNWWWXRRdp8BBBB/+PRRRRNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNWPp/54BB5/dNRWWWNNNNNNNNNNNNNNNNNNNNWXUUYEkGcmqq",
  "kmrKKbJdRRRRRNWWWWWWNNWWNNNNNNUUXj+54BBBB09/nSSTRRNNWWWWNNNNNNNNNNNNNNNNNNNNOURTnp588BBBB0grRRWWNNNNNNNNNNNNNNNNNNNNUUUUYEkGcsqq",
  "kkrKKbJdRRRRNNWWWWWWNNWWNNNNNNUUXjpBBBBBBB500+VXRRRRWWWWNNNNNNNNNNNNRNNNNNNROUSzM08BBBBBBB/dRRWWNNNNNNNNNNNNNNRRNNNNUUUUYEkGcsqq",
  "kmrKKbJdRRRRRNWWNRNNRRRRNNNNNNUUSd/4FFF7B7B40colTRRRXWWWWWWWNNNNNNNNRRNROOUUYrnMM4BB77FFD8/bkXNNNNNNNNNNNRRRRRRRRNRRUUUUYGkGcmqq",
  "kmrKKbJdRRRRRNWWNNRRRRRRRNNNNNUUdgA7FFJ76BBBBB/edSRRXWWWWWWWRRRRRRRRRRRRUUUUNo/B44B487FFF34/xSRNNNNNNNNNRRRRRRRRRRRRUUUUYGkGcsqq",
  "kmrKKnJdUURRRRWWNNRRRRRRRRNNOUUUPgABFFLL78BBBBBcgdVXRRUURRRRRRRRRRRRRRUUUUdd+cBBBBB18LJLF4B/zURNNNNNNNRRRRRRRRRRRRUUUUUUYGkGcsqq",
  "mmrKKbJdUURRRNWWNNRRRRRRRRRNOUUUPpABFFLLLKBBBB630/dNRRUURRRRSSRSRRRRRRUUUUd/23BBBB7DLLLLFBB/zURNNNNNNRRRRRRRRRRRRRUUUUUUYEkGcssq",
  "kkrKKbJYUURRXWNNNNUURRRRRRRRUUUUPp84FJLLLLLA7BBB30p+X+ggg+++g+g++gg+ggzPY+/B8BBBB3KLJLLLF38/zXRNNNNNNRRRRRRRRRRRRRUUUUUUYGkGcsqq",
  "kkrKKbJYUURRXWNNNNUURRRRRRRNOUUUPp84FLLLLLLDFBBB7309y++++++++++++++++++zyDD1BB447DLLLLLLF38/zXNNNNNNNNRRRRRRRRRRRNOOUUUUYGkGcsqq",
  "kkrKKbJYUURRRRWWOUUURRRRRRRRUUUUdp84FLLLLLLLL778BBB9p/55555555500055550p/9BB33907LLLLLLLF3B/zXWWNNNNNNNRRRRRRRRRRRUUUUUUSGkGcmqq",
  "kkrKKbJYUURRRRXXUUUURRRRRRRRUUUUdp84FLLLLLLLLL77BB7BB76666886661111111B8B3BB331LLLLLLLLLF3B/zXWWNNNNNNNRRRRRRRRRRRUUUUUUSEkGcmqs",
  "mkrKKbJdRRRRRRRRRRRRRRRRRRRRXXUUdp84FLLLLLLLLLLK88888888888883333366666666663FLLLLLLLLJLFB8/zXRWNNNNNNNRRRRRRRRRNNUUUUUUQEkGcsqq",
  "mmrKKbJdRRRRRRRRRRRRRRRRRRRRWWUUdp8BFJLLLLLLKA668888888888888888888666666666677KLLLLLLJLFB8/zWRWNNNNNNRRRRRRRRRRRNUUUUUUQEkGcmqq",
  "mmrKKbJdRRRRRRRRRRRRRRRRRRNNNNOUNp04FFLLLLLA7333888888888888888888888366666666876LLLLLJLF48/zXRWNNNNNNRRRRRRRRNRRRUUUUUUYGiGcsqq",
  "mmrKKbJdRRRRRRRRRRRRRRRRRNNNNNOUdp84FFLLLLF68888888888888888888888888366666666661FKLLLJLFB8/zXRWNNNNNNRRRRRRRNNNRRUUUUUUYEiGcsqq",
  "mmsKKbJdRRRRRRRRRRUURRRRRNNNOOOUdp84FJLLJF8888888888888888888888888888666666663888DFLLLLFBB/zXRNNNNNNNNRRRRRRNNNRRUUUUUUSGiGcmqq",
  "mmsKKbJdRRRRRRRRRRUURRRRNNNNOOOONp84FFLL733388888888888888888888888888866686888888855LLLFBB/zXRNNNNNNNNNNRRRRNNRRRUUUUUUSGkGcmqq",
  "kmrKKbJdRRRRRRRRRRRRUURRNNNNOOOONpABFJLA2738888888888888888888888888888883888888888876JLF3B/zTRRNNNNNNNNNNRRRNNRRRUUUUUUYEkGcmqq",
  "mmrKKbJdRRRRRRRRRRRRUUNNNNNNOOOOPp08FKK3BB88888888888888888888888888888888888888888887KKF08/zTRRNNNNNNNNNNNNNNNRRRUUUUUUYEiGcmqq",
  "kkrKKbJdRRRRRRUUUURNNNNNNNNNOOWXUl/B8666888888338888888888888888888888888888888888888886BB/fdRRRRNNNNNNNNNNNRNNRUUUUUUUUYEkGcmqq",
  "kksKKbJdRRRRRROOOUNNNNNNNNNNOOWWTq+86666888833333388888888888888888888833833338888888366BB/nPRRRRNNNNNNNNNNNRNNRUUUUUUUUSEkGcmqq",
  "mmrKKbJdRRUUWWWWNRNNNNNNNNNNNNOOd+M8666688333333333333388888888888888333333333338888866666a/zXRRRNNNNNNNNNNNNNNRUUUUXXXXYEkGcmqq",
  "mmrKKbJdRRUUWWWWNNNNNNNNNNNNNNOOd/266666833333333333333888888888888883333333333338886666660/+SRRRRNNNNNNNNNNNNNNOOOOXXXXYEkGcsqq",
  "kksKKbJdRRUUWWWWNNNNNNNNNNNNNNUdd/33336633333341000033338888888888883332BB000B333366666633B/glRRRRNNNNNNNNNNNNNNNNOOXXXXYEkGcrqq",
  "kksKKbJdRRUUXWWWNNNNNNNNNNNNNNU+c733336633332240///p04333388888888333332/p///02233666666337BD+SNNNNNNNNNNNNNNNNNNNOOWXXXYEiGcrqq",
  "mmrKKbJdRRRRUUWWNNNNNNNNNNNNOOX+cB336666333310//p/gp//A1668888888333349//p//+//01B66666666BBD+RNNNNNNNNNNNNNNNNNNNOOXXXXYGkGcqqq",
  "mmrKKbJdRRRRUUWWNNNNNNNNNNNNUUX+cB33666633338K//00/p+/K0663383888333BKKp90Lp+p/K9666666666BBD+RNNNNNNNNNNNNNNNRRRNOUXXXXYGkGcqqq",
  "kkrKKbJdXXRRUUXWNNNNNNNNOUWWXXSzcB33663333335p900/p+pp+066663333BBBBBMp009/+++pp04666633BBBBD+RWNNRRRRNNNNNNNNRRUUUUXXXXQGmGcrqq",
  "kkrKKbJdXXRRUUXWNNNNNNNNOUWWXXS+cB33663333325p000/p+pp+066863333BBBBBMp000p+++pp07666633BBBBD+RWNNRRRRRNNNNNNNRRUUUUXXXXQEkGcrqq",
  "kkrKKbJdhURRUUUONNNNNNNNWXXXTXX+cB23333333448p909/++pp+0BBBBBBBBBBBB1M+009p++++p06BBBBBB33BBD+YXXXXXRPRRNNNNNNRRUUUUUUUUQGkGcqqq",
  "kkrKKbJdhURRUUUONNNNNNNNW++onld+c12223323344Bpp+++++pp+0BBBBB44444BB6Mpp++p++++p06BBBBB43218D+ddey++dRRRNNNNNNRRUUUUUUUUQGkGcqqq",
  "mmrKKbJYhURRUUOONNNNNNNNXu++++pp+pp//MK05B225p+p+++++/+0BBB0500008BBB49+pp++pp+/07BB59Ka///ppp++++z+NURRNNNNNRRRRRUUUUUUYEkGcqqq",
  "mmrKKbJYhURRUUUONNNNNNNNWWWWXWVpMDKMc///9B22B0//++++//02BBB0/ppp/8BB3B5ppp++ppp486B4/p//cLDD9+kNYWOUXXRNNNNNNRRRNNUUUUUUYGkGcqqq",
  "kksKKnJYhURRRRRNNNNNNNNNUUUUUUY+aDA64B38BB223199++pp902333BA9/p+DBBB33D9/ppppK0B778644BBBB1DD+PRRRRRRRNNNNNNRRRRUOUUUUUUQGiGcqqq",
  "kksKKnJYUURRRRRNNNNNNNNNUUUUUUY+aDD7B42277AAAAA1LLLL9133332B8K/KABB43227LLLLKDAAAAA1BBBBBBDDD+PRRRRRRRNNNNNNNRRRUUUUUUUUQGiGcqqq",
  "mmrKKnJYUURRRRRNNNNNNNNNUUXXUhP+aDDD200991LLLLLL336633BB50B720/341B8833333B47FLLLLLD05A32DDDD+jRUUhURRNNNNNNNRRRRRUUXXXXSGqGcrqq",
  "mmsKKnJYUURRRRRNNNNNNNNNUUWXUhj+MDM///p/97LLLLLL836633BB9/9380g9045/973333116FLLLLLD//p//cLD9+dVhhhhRRNNNNNNNRRRRRUUXXXXSGqGcsqq",
  "mmrKKbJYRRRRUUNNNNNNNNNNOPrz+++p+///L90807LLLLLL866666660M/00/D/90g0836666667FLLLLLD1999Lp/p+++++zudNRRNNNNNNRRRRRUUUUUUSGqGcqqq",
  "mmsKKbJYSRRRUUNNNNNNNNNNWd++zyldl/DD64117533002566666666B00//020/p90336666668655312836447DDM+jdlz+z+dXRRNNNNNRRRRRUUUUUUSGqGcqqq",
  "mmrKKbJYSRRRRRNNNNNNNNNNNRNNUUXYdpDDDDD32333333333388888668991228508663366388866BBBB445DDDDM+iiPRRSSRRRRNNNNNRRRRRUUUUUUSGqGcqqq",
  "mmrKKbJYRRRRRRNNNNNNNNNNNRXXUUdz+pccccDD853333888888888866B666668666668886888866BBBB42DDLcag+zzNRRhhRRRRNNNNRRRRRRUUUUUUYGqGcqqq",
  "mmrKKbJdRRRRRRNNNNOONNOOXXXTTlfccccccaLD133B33888888888883666666668888888888833333B5AADDMccccccenXXXRRRRRNNNRRRRRRUUUUUUSGkGcrqq",
  "mmrKKbJdSRRRRRRNNNOONNOUXXyzz905BBBBB9DMMLDA33888888888888866666668888888888833332DDMMMM9BBBBB40DzzyRRRRRRNRRRRRRRUUUUUUYGkGcsqq",
  "mmrKKbJdhURRRRRNNNOOOOXXrl//c0BB3366B48//LDAA4333333888866666666666888863833333321D0/c//BB666666K//+lQUPRRRRRRRRRRUUUUUUQGqGcrqq",
  "mmrKKbJdhURRRRRNNNOOOUXd+/03B7BB3366BB7BBp/DD632333333336666666666663366333333381DD//0B4BB666666BBB//bdRRRRRRRRRRRUUUUUUQGqGcrqq",
  "kksKKbJYhURRRRNNOOOONRP+M1326666666666BB210/DD633333333888888888888888888888335DDD/023666666BB8377B40/+WRRRRRRRRRRUUUUUUQGkGcrqq",
  "kksKKnJYhURRRRNNOOOORR+g04336666666666BB322D/DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDgM033666666BB88BBBBBK/+RRRRRRRRRRUUUUUUQGkGcsqq",
  "mkrKKbJYhUUUUONNOOOUXPp0123333666666BB333244/DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD/1133336638888888BBB49+PRSRRRRRRRUUUUUhQGkGcsqq",
  "mkrKKbJYhUUUUONNOOOUXPp0223333666666BB333244/DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD/0122336633888888BBB40+PYSSSSRRRRUUUUUUQGkGcsqq",
  "mmrKKbJYhUUONNNNOONRr++0011711563833B01B2004/gp///pp//////////////////////pp//////91134108BB38BB15B1180p+zjPSShUUUUUUUUUYGkGcsmm",
  "mmrKKbJYhUUONNNNOUNR+C/0AD6BDD133833BDDB7DD5/LGGHHHHHHHGHGGGGGGGGGGGGGGGGGGGGGGGGp9ADA4DD2BB38BDDABDD10/EFfNSShhhUUUUUUUYJkGcsmm",
  "mmrKKbJYhUUUOOOOOUdgJJ/ADDA4DD1B3883BDDB6DDD+LIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIpDDDA3DD1BBBBBDDABDDA9/HHJzWVSShhhUUUUUYGkGcmsq",
  "mmrKKbJYhUUUUUOOUUdcHI/DDDA4DD1B3333BDDB6DDDpMLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL+DDDA3DD1BBBBBDDABDDDApKIIcdUSShhhhUUUUYGkGcmsq",
  "mmrKKbJdhURRUUUOTR+GIL/DDDA2DD071111BDDDDDDM+oywyyyyyyyyyyyyyyyyyyyyyyyyyyyyyywyx+DDDDDDD111118DDAADDDD+yKII+iSSSShUUUUhYGkGcqsq",
  "mmrKKbJdhhRRUUUUTRpGIpzDKDDDDDDDDDDDDDDDDDAMzwwwyyyyyyyvvvvfffffvvvvwwyyyyyyyywwwz+9DDDDDDDDDDDDDDDDDDDzyyII/TSSSShUUUUUYGkGcqqq",
  "mmrKKbJYhhRRRRUUTY/GI+z+aDDDDDDDDDDDDDDDDD/+ywwwwwwwvvffffbbbbbbbfffffuwwwwwwwwwwwz+DDDDDDDDDDDDDDDDDp+wwyIIpiSShhhUUUUUYGkGcmsq",
  "mmrKKbJYhhRRRRUhUYpGIgydepDDDDDDDDDDDDDDK++dwwwwwwvfffbbbbbbbbbbbbbbbfffuwwwwwwwwwdb+DDDDDDDDDDDDDD//MdxwyIIpiSShhhhUUUUYGkGcmqq",
  "mmrKKbJdhhUhhhhhhjpGI+ydMMz//DDDDDDDDKp/gMddwwwwvffbbbbbbaaaaaaaabbbbbbffuwwwwwwwwddbp//DDDDDDDDL//bddMywoIIgYShhhhhUUUUQJkGcqqq",
  "mmrKKbJdhhhhhhhhhjpGIzydMMM++KKKKKKKKL+bddddwwwufbbbbaaaaaaaaaaaaaaaabbbbfuvwwwwwwddddpgKKKKKKKKM+baddMywoIIpYShhhhUUUUUYJkGcqqq",
  "mmrKKnJYhhhhXiiiij+GI+wdddddazzzzzzzzoMdddddxwufbbbaaaaaaaaaaaaaaaaaaaabbbfuuwwwwwdddddbzzzzzzzzodMMdddwwoIIgYSUhhhUUUUUQGqGcrkk",
  "mmrKKnJYhhhhjjjPXj+GI+wwedddMMdddddddddddddxwufbbbaaaaZZZZZZZZZZZZZaaaaabbbfuwwwwwwdddddddddddddddMMdzwwwoIIpYSUhhhUUUUUQGqGcrkk",
  "mmrKKbJYSShr+++zkdpHIzwwwwddddMMMMMMMddddyyyvfebbaaaZZZZZZZZZZZZZZZZZaaaabbbfvwwwwwyydddddddMMMMdddzxwwwwoIIpYSUhhhhUUUUQGkGcrqq",
  "mmrKKbJYSYd/030M+VpHIzwwwwdddddMMMMMdddblwyvunbbaaaZZZZZZZZZZZZZZZZZZZaaaabbbfwwwwwwydddddddMMMMdddxwwwwwoIIpYSUhhhhUUUUYGqGcsqs",
  "mmrKKbJYXy/B24420+zHI+wwwwwwzdddMMdddbnwwwvvfebaaaaZZHHHHHZZZZZZZZZZZZZaaaabbfvwwwwwwwwwddddMMdddlwwwwwwwwIIgjSUSShhhUUUQGkGcsqq",
  "mmrKKbJYXy/34BBBDM/HIowwwwwwyzxMMMddyxwwwwvufbbaaaZZZHEEEEGHJZZZZZZZZZZZaaabbbfwwwwwwwwuzdddMadowwwwwwwwwwIIgjSUSShhhUUUQJkGcsqq",
  "mmrKKnJdXz/333BBB0pHIowwwwxxwwwwuwwwwwwwyvvfnbbaaaZZZGEEEEGGJZZZZZZZZZZZZaaabbfvwwwwxxxxwxuwwwwxwwwwwwwwwwIIgYSSSShhhUUUYJkGcsqq",
  "mmrKKnJdiz/A33BBB0pHIowwwwxxwwwwwwwwwwwwyvvfbbaaaZZZZGEEEEEEEGGZZZZZZZZZZaaabbfuwwwwxxxxwwwwwwwwwwwwwwwwwwIIgYSSSShhhUUUYJkGcsqs",
  "mmrKKbJdiz/D33334DpHIowwwwxxxxwwwwwwwwwwvuufbbaaaZZZZGEEEEEEEEEGGGZZZZZZZZaabbefvywwwwxxwwxxwwwwwwwwwwwwwwIIpijhSShhhUUUVJqHcsqs",
  "mmsKKbJdiz/D13330DpHIowwwwxxxxwwwwwwwwwwvuufbbaaaZZZZGEEEEEEEEEGGGZZZZZZZZaaabbfvywwwwxxwwzzwwwwwwwwwwwwwwIIgijhSShhhUUUPJqHcsqs",
  "mmsKKbJdiz/DB3321DpHIgwwwwxxxxxxwwwwwwwvvuubbaaaZZZZZGEEEEEEEEEEEEGGGZZZZZaaabbfvywwyyyyoaECyywwyywwwwwwwwIIpYYYYYhhhUUhQJmGcsqs",
  "mmsKKbJdiz/DD85DDD/HIowwwwxxxxxxwwwwwwwvvuubbaaaZZZZZGEEEEEEEEEEEEEEGEJZZZZaabbfuvwwyyyyzbEEcywwoowwwwwwwwIIgYYYYYhhhUUUQJmGcsqs",
  "mmrKKbJdiz/DDA1DDD/HIowwwwxxxxxxxxwwwwwvvunbbaaaZZZZZGEEEEEEEEEEEEEEEEEEJZZaabbeuvzyzfbxyyCEgvyzFcozyxwwwwIIgYjhYYhhhhUUQJmGcsqs",
  "mmrKKbJdiz/DDDDDDD/HIowwwwxxxxxxxxwwwwwvvunbbaaaZZZZZGEEEEEEEEEEEEEEEEGGGGFaabbeuyypLEMyyyCEgvyzCEEczxwwwwIIgYjhYYhhhUUUQGkGcsqs",
  "mmrKKbJdiy/DDDDDDD/GIowwwwxxwwxxxxwwwwyyvunbbaaaZZZZZGEEEEEEEEEEEEEEEEEGGGFaabbnuoFEELgzyyCEgvyyz/EECywwwwIIgYYihhhhhhUhYJmGcsqq",
  "mmrKKbJdYdbgDDDDDD/HIowwwwxxwwxxxxwwwwyyvunbbaaaZZZZZGEEEEEEEEEEEEEEEEEGGEFaabbnuoCEC/zzyyCEgvyyMEEELywwwwIIgYYihhhhhhhhYJkGcsqq",
  "mmsKKbJdiXr/DDDDDDpHIowwwwwwwwxxxxxxwwyyvuubbaaaZZZZZGEEEEEEEEEEEEEEEEGGGZZaabbeuyzZEELyyyCEgoyyECczwwwwwyIIgihSSShhhhhhYJkGcmqs",
  "mmsKKbJdXXdpDDDDDDpHIgwwwwwwwwxxxxxxwwyyvuubbaaaZZZZZGEEEEEEEEEEEEEEEIJZZZZaabbnuyxz+CLyyyCEccyy/ooxwwwwwyIIgihSSShhhhhhYJkGcmqs",
  "mmtKKbJdhhYVpDDDDDpHIowwwwwwxxxxxxxxwwwwvunbbbaaZZZZZGEEEEEEEEEEEEEEEIJZZZaaabbnuyyyyzzyyyo/ELyyyywwwwwwwoIIgYYSSShhhhhhYGmGcsqs",
  "mmrKKbJdhhYPdgMDDDgHIowwwwwwxxxxxxxxwwwwvuubbbaaaZZZZGEEEEEEEEEGGGZZZZZZZZaaabbnvyyyyzyxyyy/ELyyyywwwwwwwoIIgYYYSShhhhhhYGkGcsqs",
  "mmrKKbJdhhhhY+g/DDpHIowwwwxxxxxxxxxxxxwwvuunbbaaaZZZZGEEEEEEEEEEEEZZZZZZZaaabbbuvywwwwwwwwofgowwwwwwwwwwwoIIgiYShhhhhhhhYJkGcsqs",
  "mmrKKbJdhhhhYPz+/DpHIowwwwxxxxxxxxxxxxwwvuunbbaaaZZZZGEEEEEEGIJZZZZZZZZZZaaabbnuvywwwwwwwwxyzowwwwwwwwwwwoIIgiSShhhhhhhhYJkGcsqs",
  "mmsKKbJdhhhhYYhdlppHIowwwwxxxxwwwwwwwwwwvvufebaaaaZZZIHHHHZZZZZZZZZZZZZZaaaabbnvwwwwwwxxxxwwwwwwwwwwwwwwwoIIgNYSSShhhhXXjGkGcsqs",
  "mmsKKbJdhhhhYYhhd+pGIowwwwxxxxwwwwwwwwwwyvufebbaaaZZZIIHHHZZZZZZZZZZZZZaaaabbnuvwwwwwwxxxxwwwwwwwwwwwwwwwoIIpNYSSShhhhXXQJkGcsss",
  "mmsKKbJYhhhhYYYYiVpHIowwwwwwwwwwwwwwwwwwyvuunbbaaaaZZZZZZZZZZZZZZZZZZZZaaabbbnuywwwwwwwwwwwwwwwwwwwwwwwwwoIIpSYihhhhhhXXYJiGcsss",
  "mmsKKbJYhhhhYYYYiPpHIowwwwwwwwwwwwwwwwwwyvuufbbbaaaaZZZZZZZZZZZZZZZZZZaaabbbnuvywwwwwwwwwwwwwwwwwwwwwwwwwoIIpSYihhhhhhXXYJiGcsss",
  "mmsKKbJYYYYYYYSSXV+HIowwwwwwwwyy/EEoyywwyyvvunbbbaaaaZZZZZZZZZZZZZZZaaaaabbbnuvywwwwwwwwwwwwwwwwwwwwwwwwwwIIpSShhhhhhUXXYJiGcsqq",
  "mmsKKbJYYYYYSSSSXk+HIowwwwwwwwyypEEgyywwyyyvvfnbbbaaaaaaZZZZZZZZZaaaaaabbbbnuvyywwwwwwwwwwwwwwwwwwwwwwwwwwIIpQShhhhhhUXXYGkGcsqq",
  "mmrKKbJYYYhhSSShdu+HIowwyyzvzMoyygECyyo//owxuunnbbbaaaaaaaaaaaaaaaaaaabbbbnuvywwwwwwwwwwxxxxwwwwxxwwwwwwwyIIpuuPjShhhUhhhGkG/mqq",
  "mmrKKbJYYYhhSSjuuu+HIowwyyfZEEzxogECyyo/EEcyvuunnbbbbaaaaaaaaaaaaaaabbbbbnuuvywwwwwwwwwwxxxxwwwwxxwwwwwwwyIIpuuunShhhhUhOJkG/mqq",
  "mmsKKbJqhhhhhduuuu+HIowwyMEEKcyyvgECyyyz/EECfwvunnbbbbbbaaaaaaaaaabbbbbnnuvywwwwwwwwwwwwwwwwwwwwwwxxwwwwwyIIpuuuunShhhhhYJkG/mqq",
  "mmsKKbJqhhhhPuuuuu+HIowwvFEEMgyyvgECyyyocEEE+xvvuunbnbbbbbbbbbbbbbbbbennuuyywwwwwwwwwwwwwwwwwwwwwwxxwwwwwyIIpuuuuvuPhhhhYGkG/mqq",
  "mmsKKbJqhhiStvuuuuzHIowwyz/EEEzyvgECzyz/EE/zwwyyvvuunnbbbbbbbbbbbbbnnnuuvvwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwyIIguuuuuurShhhYGiGcsqs",
  "mmsKKbJqhhiYvuuuuuzHIzwwxyxycFzyvgECgoz/cfyxwwyyyvvvuunnnnnnnnnnnnnuuuvvyywwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwyIIguuuuuuujhUUYGiHcsqs",
  "mmsKKbJqhhijuuuuuu+HIowwwwyyxxyyyg/GEvyywwwwwwwwwwyyvvuuuuuuuuuuuuuuvvyywwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwyIIguuuuuuujShUXGkGcsqs",
  "mmsKKfJqhhiVuuuuuu+HIowwwwyyyyyyzygEEyyywwwwwwwwwwyyyvvuuuuuuuuuuuvvvyyywwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwyIIgnuuuuuujShUXGkGcsqs",
  "mmrKKbJYhhhhluuuuvzHIgywyyyyyyyyyyy//zwwwwwwwwwwwwwwyyyvvvvvvvvvuuvvyyyywwwwwwwwwwwwwwwwwwwwwwwwwwwwwwyyxoIIgtuuuuujhhXXXGkGcsss",
  "mmrKKbJYhhhhjvuuuvzGI/zyyyyyyyyyyyyzxywwwwwwwwwwwwwwyyyyxxvvyyxxyyyyyyyywwwwwwwwwwwwwwwwwwwwwwwwwwwwwwyywoIIpuuuuuuRhhXXXGkGcsss",
  "mmsKKbJYhhhhituuuuvzIIpoooooooooooooooooooooooooooxxoooooooooooooooooooooooooooooooooooooooooooooooooooogcIcvuuuunQShhhUQGkGcsss",
  "mmsKKbJYhhhhiXjvuuuunfIcggggggggggggggggggggggggggggggoggogggggoooggggggggggggggggggggggggggggggggggggggLIouuuuunXSUhUUUYGkGcsss",
  "mmsKKeJYhhhhhhjSnuvvuuvJIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIILvvuuurjYShhhUUhQGhGcsqs",
  "mmsKKbJqhhhhhhhhiSuuuuvzggpppggpgggggggppgppggggggggggggpgggpgggpppppggpgggggggggggggggggggggggggggggggguvuunjYhSShhhhhhQGhGcsss",
  "mmsKKbJYhhhhhhhhYYjjnnvvvvvvvvvvyyvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvunjSShhhhhhhhhhQGkGcsss",
  "mmsKKbJYhhhhhhhhYYhhPPPuwvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvudPYYSShhhhhhhhhhQGmGcrss",
  "mmsKJbJqhhhhhhhhhhYYYYYSmltttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttjhhSShhhhhhhhUUUhQGkGcsmm",
  "mmsKJeJqhhhhhhhhhhYYYYiihiXiiiiiiiiiiiiihhhhhhhhhhhhhhhhhhiiiiiiiiiiiiiihhhhhhiiiiiiiiiiiihhiiiiiihhhhXPhhSShhhhhhUUUUUUQGkGcsmm",
  "mmsKKeJjVVjjjjjjjYjjjjjjddYjYYYYYYYYYYqqqqjjqqqqqqqqqqqqqqqqqqqqqqqqqqYqqqqqqqqqYqYYqqqYYYjjjjYYYjjjjjYYYYYYjjYYYYYYYYYYVGsGcsmm",
  "mmlMLbGLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLGmZermm",
  "mmmmkbGcccccgggggggccccccccccccccccccccecceccececcccccccceccccgccccccccceeeeegccceccfccccccceccccccccceeecccccccgcccggcccGttmmmm",
  "mmmmmlFnnnllllnnnlllnnllllnnllllllnnnlnnnnnlllllllllllnnnnnlbbnnnnnllllllllnnllllnnnlllllnbblnnnllllllllllllnlllllllllnllJtrmmmt",
  "mmmmmmmcHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHGHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHGblmmmmmt",
  "mmmmmmkdfbbbbbefffefnbfebbbbbbbbbbbbfffffefeefeebbbbnnffbbbbeeeeeeeeeeeennbbeeeeeeeebbbbbbbbbbbbbfbbbbbbeeeeeeebbbefbbbbttmmmmmt",
  "mmmmmmmmttttttttttttttttttttttttmmmtttttttttttttttttttttttttttttttttttttttttttmmttttttttttttttttttttttttttttttttttttttttmmmmtttt",
  "mmmmmmmmmmtmmmmmmmttttttttttttttmmmmtttttttttttttmmmttttttttttttttttttmtttttttmmtttttttrrrrrtrrrttttttrrrrrtttttttttttttmmmmtttt",
];


// ---- PNG 编码（RGBA8，filter 0）----
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// ---- 字符 → 像素 ----
const ALPHA = "."; // 透明格
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
const rgbCache = new Map<string, [number, number, number]>();
function charToRgb(ch: string): [number, number, number] {
  const cached = rgbCache.get(ch);
  if (cached !== undefined) return cached;
  const idx = CHARS.indexOf(ch);
  if (idx < 0 || idx >= PALETTE.length) throw new Error(`gen-icon: unknown sprite char ${JSON.stringify(ch)}`);
  const hex = PALETTE[idx]!;
  const rgb: [number, number, number] = [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  rgbCache.set(ch, rgb);
  return rgb;
}

// ---- 网格 → 512×512 位图（每格 SCALE×SCALE 实心块，无抗锯齿 = 像素艺术） ----
if (SPRITE.length !== GRID || SPRITE.some((r) => r.length !== GRID)) {
  throw new Error(`gen-icon: sprite must be ${GRID}x${GRID}`);
}
const px = new Uint8Array(SIZE * SIZE * 4);
for (let gy = 0; gy < GRID; gy++) {
  const row = SPRITE[gy]!;
  for (let gx = 0; gx < GRID; gx++) {
    const ch = row[gx]!;
    if (ch === ALPHA) continue; // 保持透明（本设计为满幅不透明，防御性保留）
    const [r, g, b] = charToRgb(ch);
    for (let y = gy * SCALE; y < (gy + 1) * SCALE; y++) {
      for (let x = gx * SCALE; x < (gx + 1) * SCALE; x++) {
        const idx = (y * SIZE + x) * 4;
        px[idx] = r;
        px[idx + 1] = g;
        px[idx + 2] = b;
        px[idx + 3] = 255;
      }
    }
  }
}

// ---- 组装 PNG ----
const stride = SIZE * 4;
const raw = new Uint8Array((stride + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (stride + 1)] = 0; // filter none
  raw.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
}
const ihdr = new Uint8Array(13);
const dv = new DataView(ihdr.buffer);
dv.setUint32(0, SIZE);
dv.setUint32(4, SIZE);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = new Uint8Array([
  ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  ...chunk("IHDR", ihdr),
  ...chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
  ...chunk("IEND", new Uint8Array(0)),
]);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`icon written: ${OUT} (${SIZE}x${SIZE}, ${png.length} bytes)`);
