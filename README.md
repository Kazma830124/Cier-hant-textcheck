# hant-textcheck

Traditional Chinese text checker — simplified-character contamination, quote balance, bold balance, blank runs, halfwidth punctuation. One command, line:column precision, Big5 false-positive filtering.

繁體中文稿件的五項體檢，一個指令。

## 為什麼

寫繁體的人最常犯的錯不是不會寫繁體，是**滑進去**：一個簡體字、一組沒配對的引號、一個半形逗號。這種錯自己看三遍也看不出來，因為你看到的是「你以為你寫的字」。

這支工具不做風格建議，只抓五種機械錯誤，位置精確到行：欄。

## 用法

```
node textcheck.cjs 檔案.md
node textcheck.cjs 一.md 二.txt
node textcheck.cjs --dir 目錄
node textcheck.cjs --strict-inner 檔案.md
```

`exit 0` 乾淨，`exit 1` 有問題。可以直接接 CI 或 pre-commit。

## 五種檢查

1. **簡體字** — 用 OpenCC 的 `STCharacters.txt`。命中時給出繁體候選。
2. **引號不平衡** — 「」和『』分開算。預設只報不平衡的行；`--strict-inner` 連「有出現就報」也抓。
3. **粗體記號不平衡** — 先去掉行內程式碼，再分別數 `**` 和單星，兩種都要是偶數。
4. **連續兩個以上空白行**。
5. **中文裡混進半形標點** — 只抓前後都是漢字的 `, . : ; ! ?`，英文句子裡的標點不會誤報。

## Big5 假陽性白名單

`群`、`秘`、`床`、`峰` 四個字不報。

OpenCC 把它們對到 羣／祕／牀／峯，但那四個字不在 Big5 裡——用 .NET 的 codepage 950 編碼會變成 `?`。所以群、秘、床、峰是台灣標準寫法，不是簡體。

**這一條是這支工具跟一般簡繁檢查最大的差別。** 多數工具會在這四個字上誤報，然後使用者就學會忽略警告。

## 已知限制

- 只認漢字（U+3400–U+9FFF）。
- 引號只檢查數量，不檢查配對順序。
- 粗體只數星號，不判斷語意。
- 簡體表是逐字的，沒有詞語判斷。
- 給 Markdown 和純文字用。拿它掃程式碼，遇到正規表達式或字串裡的星號會誤報。

## 授權

`st-characters.txt` 來自 [OpenCC](https://github.com/BYVoid/OpenCC)（Apache-2.0）。其餘 MIT。
