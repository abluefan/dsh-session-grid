// dsh-session-grid host half
//
// 呢個插件純粹係 client 側（UI）功能，host 側冇任何工作。
// 但 Loader 會 load package main（./index.js），所以照樣要 export
// name / apply，否則 mount 會報錯。

/** 插件名，必須與 package.json 的 name 一致。 */
export const name = 'dsh-session-grid'

/** 冇 host 側依賴。 */
export const inject = []

/** 插件入口（host 側無事可做）。 */
export function apply() {}
