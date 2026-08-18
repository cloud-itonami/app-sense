#!/usr/bin/env nbb
;; verify-docs-claims.cljs — README.md と docs/operator-quickstart.md が
;; 「測った」と言っている数を、実際に測り直して突き合わせる。
;;
;;   nbb docs/verify-docs-claims.cljs
;;
;; exit 0 = PASS / 1 = FAIL / 3 = 判定できなかった（0 でも 1 でもない）
;;
;; ⚠ **この repo の外を要する 3 件はここで検査しない。** 手元に相手が無いときの
;;   「引けなかった」を「一致した」と同じ値で返すと、測れなかったことが緑になる
;;   （ADR-2608136000）。3 件は operator-quickstart.md に置いて人間に引かせる:
;;
;;     §4 custody          — etzhayyim/root の checkout が要る
;;     §3 upstream 削除    — kotoba-lang/kotodama-host の checkout が要る
;;     §3 npm / §6 DNS     — ネットワークが要る
;;
;;   代わりにここでは *この repo の中だけで決まる原因* を検査する —— ビルド
;;   マニフェストが 0 件であること、import 指定子が消えた側の名前であること、
;;   23 中 12 の handler が stub であること、CLAUDE.md が持っていない wasm/ を
;;   記述していること。

(require '["node:child_process" :as cp]
         '["node:fs" :as fs]
         '[clojure.string :as str])

(defn- die! [code & msg]
  (binding [*print-fn* *print-err-fn*] (apply println msg))
  (js/process.exit code))

(defn- git [& args]
  (try
    (str/trim (str (cp/execFileSync "git" (clj->js (vec args)) #js {:encoding "utf8"})))
    (catch :default e
      (die! 3 "UNDETERMINED: git" (str/join " " args) "が失敗した —"
            (or (some-> e .-message) "(理由不明)")))))

(defn- slurp* [p]
  (when-not (fs/existsSync p)
    (die! 3 "UNDETERMINED:" p "が無い。この repo のルートで実行すること"))
  (fs/readFileSync p "utf8"))

;; ---------------------------------------------------------------- 入力の床
;; 「入力が無いとき pass を返さない」（ADR-2608136000 の 1 番目）。

(def ^:private tracked
  (let [ls (remove str/blank? (str/split-lines (git "ls-files")))]
    (when (zero? (count ls))
      (die! 3 "UNDETERMINED: git ls-files が空。commit の無い repo か、repo 外で実行している"))
    ls))

;; 抽出が運んだ 4 ファイル + 抽出自身が足した 2 ファイル。
;; 文書の数はこの集合について述べており、後から足す文書（この docs/ を含む）は含まない。
(def ^:private inherited ["CLAUDE.md" "NOTICE" "kotodama.jsonld" "src/app.ts"])
(def ^:private canonical-records ["README.edn" "migration.edn"])
(def ^:private pre-existing (into inherited canonical-records))

;; tracked に無いパスは「測れなかった」ではなく「消えたという測定結果」なので
;; nil を返して FAIL に落とす。ここを die! 3 にすると、ファイルが 1 つ消えただけで
;; 「判定できなかった」になり、消えたことを報告している check 1 の FAIL が
;; 出力される前に握り潰される（実測: kotodama.jsonld を消して exit 3 になった）。
;; tracked に在るのに読めない場合だけが本当の「判定できなかった」。
(defn- blob-bytes [p]
  (when (some #{p} tracked)
    (let [n (js/parseInt (git "cat-file" "-s" (git "rev-parse" (str "HEAD:" p))) 10)]
      (if (js/isNaN n)
        (die! 3 "UNDETERMINED:" p "は tracked なのに blob サイズが読めなかった")
        n))))

(defn- sum-bytes
  "欠けているパスがあれば nil。合計を 0 に丸めて「小さくなった」と報告しない。"
  [paths]
  (let [ns (map blob-bytes paths)]
    (when (every? some? ns) (reduce + 0 ns))))

(def ^:private results (atom []))
(defn- check! [label ok? detail]
  (swap! results conj {:label label :ok? (boolean ok?) :detail detail}))

;; ---------------------------------------------------------------- 検査

;; 1) 継承した 6 ファイルが全部まだ在る（後から消えたら文書は嘘になる）
(let [missing (remove (set tracked) pre-existing)]
  (check! "pre-existing files still tracked" (empty? missing)
          (if (empty? missing) "6/6 tracked" (str "missing: " (str/join ", " missing)))))

;; 2) 合計 = 24973 B、継承 4 ファイル = 24289 B（migration.edn の :bytes）
(defn- bytes-check! [label want paths]
  (let [got (sum-bytes paths)]
    (check! label (= want got) (if got (str got " B") "a file is missing — not measurable"))))

(bytes-check! "pre-existing bytes = 24973" 24973 pre-existing)
(bytes-check! "inherited bytes = 24289 (migration.edn :bytes)" 24289 inherited)
(bytes-check! "src/app.ts = 14395 B" 14395 ["src/app.ts"])
(bytes-check! "CLAUDE.md = 7027 B" 7027 ["CLAUDE.md"])

;; 3) migration.edn 自身が 4 / 24289 / 691c245 / bf8574b を主張し続けている
(let [m (slurp* "migration.edn")]
  (check! "migration.edn claims :tracked-files 4" (str/includes? m ":tracked-files 4") "")
  (check! "migration.edn claims :bytes 24289" (str/includes? m ":bytes 24289") "")
  (check! "migration.edn pins revision 691c245d"
          (str/includes? m "691c245da48f3acb11dd757218f189ff2482b1c8") "")
  (check! "migration.edn pins git-tree bf8574b1"
          (str/includes? m "bf8574b1567418f818fe739832f9a9c11eca1473") ""))

;; 4) ビルドマニフェストが 0 件（「ビルドできない」の repo 内の原因）
(let [manifests (filter #(re-find #"(?i)(^|/)(package\.json|package-lock\.json|tsconfig[^/]*\.json|wrangler\.(toml|jsonc?)|deps\.edn|shadow-cljs\.edn|Cargo\.toml|vite\.config\.[jt]s)$" %) tracked)]
  (check! "zero build manifests" (empty? manifests)
          (if (empty? manifests) "0" (str/join ", " manifests))))

;; 5) test ファイルが 0 件
(let [tests (filter #(re-find #"(?i)(^|/)(test|tests|spec)/|\.(test|spec)\.[a-z]+$" %) tracked)]
  (check! "zero test files" (empty? tests)
          (if (empty? tests) "0" (str/join ", " tests))))

;; 6) import 指定子はちょうど 1 つで、消された側の名前である。
;;    ⚠ 「解決できない」ではなく「その名前を import している」を検査する ——
;;    解決可否は node_modules の有無に依存し、この repo の中だけでは決まらない。
(let [ts-files (filter #(str/ends-with? % ".ts") tracked)
      _ (when (zero? (count ts-files))
          (die! 3 "UNDETERMINED: .ts ファイルが 1 つも無い。文書の前提が崩れている"))
      src   (slurp* "src/app.ts")
      specs (->> ts-files
                 (mapcat #(re-seq #"from \"([^\"]+)\"" (slurp* %)))
                 (map second) set)
      names ["asAgentTool" "createWorkerExport" "nowISO" "withCapabilityTags"
             "HostSDK" "parseYataRows" "decodeJson" "nsid" "parseLexiconInput"]]
  (check! "exactly one import specifier" (= 1 (count specs)) (str/join ", " (sort specs)))
  (check! "specifier is @etzhayyim/kotodama-host-sdk"
          (contains? specs "@etzhayyim/kotodama-host-sdk") "")
  (check! "all 9 documented names are imported"
          (every? #(str/includes? src %) names)
          (str (count (filter #(str/includes? src %) names)) "/9"))
  (check! "no node_modules vendored here"
          (not-any? #(str/starts-with? % "node_modules/") tracked) ""))

;; 7) 23 command / 23 handler / 12 が stub、名前も一致
(let [src (slurp* "src/app.ts")
      cmds     (count (re-seq #"\.command\(nsid\(" src))
      handlers (count (re-seq #"(?m)^async function cmd" src))
      stubs    (count (re-seq #"SQL deprecated 2026-04-12" src))
      stubbed  (->> (str/split-lines src)
                    (reduce (fn [{:keys [cur acc]} line]
                              (cond
                                (re-find #"^async function (cmd\w+)" line)
                                {:cur (second (re-find #"^async function (cmd\w+)" line)) :acc acc}
                                (and cur (str/includes? line "SQL deprecated"))
                                {:cur cur :acc (conj acc cur)}
                                :else {:cur cur :acc acc}))
                            {:cur nil :acc #{}})
                    :acc)
      expected #{"cmdScanGet" "cmdScanList" "cmdBuildingGet" "cmdBuildingList"
                 "cmdBuildingExport" "cmdFloorGet" "cmdRoomGet" "cmdStructureGet"
                 "cmdStructureList" "cmdSensorStatus" "cmdVizRender" "cmdVizTimeline"}]
  (check! "23 commands registered" (= 23 cmds) (str cmds))
  (check! "23 handlers defined" (= 23 handlers) (str handlers))
  (check! "12 stubbed read paths" (= 12 stubs) (str stubs))
  (check! "the 12 stubbed handlers are the documented ones" (= expected stubbed)
          (str (count stubbed) " — "
               (str/join ", " (sort (into (map #(str "unexpected:" %) (remove expected stubbed))
                                          (map #(str "missing:" %) (remove stubbed expected)))))))
  (check! "src/app.ts is 363 lines" (= 363 (count (str/split-lines src)))
          (str (count (str/split-lines src)))))

;; 8) CLAUDE.md が、この repo に無いものを記述し続けている
(let [c (slurp* "CLAUDE.md")
      modules ["sense-pointcloud" "sense-mesh" "sense-acoustic" "sense-signal" "sense-fusion"]]
  (check! "CLAUDE.md names all 5 WASM modules" (every? #(str/includes? c %) modules)
          (str (count (filter #(str/includes? c %) modules)) "/5"))
  (check! "CLAUDE.md documents a wasm/ build path"
          (str/includes? c "cd wasm/etzhayyim-wasm-sense-") "")
  (check! "no wasm/ tree in this repo"
          (not-any? #(str/starts-with? % "wasm/") tracked) "")
  (check! "CLAUDE.md documents the removed SQL graph layer"
          (str/includes? c "HAS_FLOOR") ""))

;; 9) NOTICE が指す CHARTER-RIDER.md が無い
(let [n (slurp* "NOTICE")]
  (check! "NOTICE references CHARTER-RIDER.md" (str/includes? n "CHARTER-RIDER.md") "")
  (check! "CHARTER-RIDER.md absent (dangling reference)"
          (not (some #{"CHARTER-RIDER.md"} tracked)) ""))

;; 10) kotodama.jsonld が worker + 2 route を宣言し、deploy 設定は無い
(let [j (try (js->clj (js/JSON.parse (slurp* "kotodama.jsonld")) :keywordize-keys false)
             (catch :default e
               (die! 3 "UNDETERMINED: kotodama.jsonld が JSON として読めない —"
                     (or (some-> e .-message) ""))))
      hosts (map #(get % "host") (get j "routes"))]
  (check! "runtimeType = worker" (= "worker" (get j "runtimeType")) (str (get j "runtimeType")))
  (check! "2 routes declared" (= 2 (count hosts)) (str/join ", " hosts))
  (check! "routes are sense./sv8q2k5r.etzhayyim.com"
          (= #{"sense.etzhayyim.com" "sv8q2k5r.etzhayyim.com"} (set hosts)) "")
  (check! "no deploy config to target them"
          (not-any? #(re-find #"(?i)wrangler|fly\.toml|Dockerfile|\.github/workflows/" %) tracked) ""))

;; 11) README.edn の boundary が app-maps を指している（一方向参照の片側）
(let [r (slurp* "README.edn")]
  (check! "README.edn points at cloud-itonami/app-maps"
          (str/includes? r "cloud-itonami/app-maps") ""))

;; 12) 文書が上の数を実際に書いている（測定値と本文の結び付け）
(let [r (slurp* "README.md")
      q (slurp* "docs/operator-quickstart.md")]
  (check! "README states 24,973 bytes" (str/includes? r "24,973") "")
  (check! "README states 24,289 inherited" (str/includes? r "24,289") "")
  (check! "README states 23 commands / 12 stubbed"
          (and (str/includes? r "23 commands") (str/includes? r "12 of the 23")) "")
  (check! "README states 48 and 24 error counts"
          (and (str/includes? r "48 errors") (str/includes? r "**24**")) "")
  (check! "README names the deletion commit 5b2b084" (str/includes? r "5b2b084") "")
  (check! "quickstart shows 24973 total" (str/includes? q "24973 total") "")
  (check! "quickstart pins bf8574b1" (str/includes? q "bf8574b1") "")
  (check! "quickstart documents exit code 3" (str/includes? q "`3` — **the check could not be made**") ""))

;; ---------------------------------------------------------------- 報告
;; evidence floor: 実行本数の床。0 件を clean にしない。
(let [rs @results
      n (count rs)
      failed (remove :ok? rs)]
  (when (< n 35)
    (die! 3 "UNDETERMINED: 検査が" n "件しか走らなかった（35 件以上を期待）。"
          "検査自身が壊れている疑いがある"))
  (println (str "CHECKED\t" n))
  (doseq [{:keys [label ok? detail]} rs]
    (println (str (if ok? "ok  " "FAIL") "\t" label (when (seq detail) (str "\t— " detail)))))
  (if (seq failed)
    (die! 1 (str "\n" (count failed) " / " n " claim(s) no longer true."))
    (do (println (str "\nPASS — " n " claims re-measured, all matched."))
        (js/process.exit 0))))
