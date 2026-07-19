# etzhayyim-project-sense

## App Identity

| Field | Value |
|---|---|
| nanoid | `sv8q2k5r` |
| domain | `sense.etzhayyim.com` |
| AT bot DID | `did:web:sense.etzhayyim.com` |
| Runtime | TS Native (`src/app.ts`) + Rust WASM (5 compute modules) |
| Data store | W Protocol Event Stream |
| UI mode | iframe (KAMI 3D renderer) |
| performerType | `system` |

## Purpose

センサーフュージョンによる建物 3D 再構成・内部構造解析。Camera/LiDAR/WiFi/Bluetooth/Mic から点群生成 → メッシュ再構成 → 構造物内部の可視化。計算カーネルは全て Rust WASM (Path B)。

## Architecture: Sensor Fusion Pipeline

```
[Sensor Input Layer]
  Camera/LiDAR ──→ PointCloud WASM (photogrammetry, depth → 3D points)
  WiFi/BLE     ──→ Signal WASM (RSSI trilateration → indoor position)
  Microphone   ──→ Acoustic WASM (impulse response → room geometry)

[Fusion Layer]
  All sensor outputs ──→ Fusion WASM (Kalman filter, occupancy grid, TSDF volume)

[Reconstruction Layer]
  Fused TSDF ──→ Mesh WASM (Marching Cubes → triangle mesh + normals)

[Visualization Layer]
  Mesh → KAMI wgpu renderer (3D building model, cross-section, heatmap)
```

## WASM Components

| Component | nanoid | Role | Algorithm |
|---|---|---|---|
| sense-pointcloud | `rp7k2m1a` | 点群生成 | Structure from Motion, depth map fusion |
| sense-mesh | `xt9n3v4b` | メッシュ再構成 | Marching Cubes, Poisson surface reconstruction |
| sense-acoustic | `qw5j8c6d` | 音響解析 | FFT, impulse response deconvolution, room dimension estimation |
| sense-signal | `hm2y7f9e` | 電波測位 | RSSI trilateration, fingerprinting, particle filter |
| sense-fusion | `zk4p1g3n` | センサーフュージョン | Extended Kalman Filter, TSDF volume integration, occupancy grid |

## Multi-DID Identity

| DID | Role |
|---|---|
| `did:web:sense.etzhayyim.com` | Primary (orchestrator) |
| `did:web:sense.etzhayyim.com:scan` | スキャンセッション管理 |
| `did:web:sense.etzhayyim.com:building` | 建物 3D モデル |
| `did:web:sense.etzhayyim.com:floor` | フロアプラン |
| `did:web:sense.etzhayyim.com:room` | 部屋単位データ |
| `did:web:sense.etzhayyim.com:structure` | 構造物 (壁/柱/梁/配管) |
| `did:web:sense.etzhayyim.com:sensor` | センサーデバイス登録 |

## NSID (com.etzhayyim.apps.sense.*)

### Scan Session
- `com.etzhayyim.apps.sense.scan.create` — スキャンセッション開始
- `com.etzhayyim.apps.sense.scan.update` — センサーフレーム追加
- `com.etzhayyim.apps.sense.scan.complete` — スキャン完了 → Fusion 起動
- `com.etzhayyim.apps.sense.scan.get` — セッション取得
- `com.etzhayyim.apps.sense.scan.list` — セッション一覧

### Building Model
- `com.etzhayyim.apps.sense.building.create` — 建物モデル生成
- `com.etzhayyim.apps.sense.building.get` — 3D モデル取得
- `com.etzhayyim.apps.sense.building.list` — 建物一覧
- `com.etzhayyim.apps.sense.building.export` — glTF/PLY/OBJ エクスポート

### Floor & Room
- `com.etzhayyim.apps.sense.floor.create` — フロアプラン生成
- `com.etzhayyim.apps.sense.floor.get` — フロアプラン取得
- `com.etzhayyim.apps.sense.room.create` — 部屋データ生成
- `com.etzhayyim.apps.sense.room.get` — 部屋データ取得 (寸法/材質/音響特性)

### Structure Analysis
- `com.etzhayyim.apps.sense.structure.detect` — 構造物検出 (壁/柱/梁/配管/配線)
- `com.etzhayyim.apps.sense.structure.get` — 構造物詳細
- `com.etzhayyim.apps.sense.structure.list` — 構造物一覧
- `com.etzhayyim.apps.sense.structure.cross_section` — 断面図生成

### Sensor Device
- `com.etzhayyim.apps.sense.sensor.register` — デバイス登録
- `com.etzhayyim.apps.sense.sensor.calibrate` — キャリブレーション
- `com.etzhayyim.apps.sense.sensor.status` — デバイス状態

### Visualization
- `com.etzhayyim.apps.sense.viz.render` — 3D レンダリングリクエスト
- `com.etzhayyim.apps.sense.viz.heatmap` — WiFi/BT/音響ヒートマップ
- `com.etzhayyim.apps.sense.viz.timeline` — 時系列スキャン比較

## Graph Labels (SQL)

```
(:Building)-[:HAS_FLOOR]->(:Floor)-[:HAS_ROOM]->(:Room)
(:Room)-[:HAS_STRUCTURE]->(:Structure)
(:Structure {kind: "wall"|"column"|"beam"|"pipe"|"wiring"|"duct"})
(:ScanSession)-[:PRODUCED]->(:PointCloud)
(:PointCloud)-[:FUSED_INTO]->(:TSDFVolume)
(:TSDFVolume)-[:MESHED_INTO]->(:Mesh)
(:Mesh)-[:REPRESENTS]->(:Building)
(:SensorDevice)-[:CAPTURED]->(:ScanSession)
(:Room)-[:ACOUSTIC_PROFILE]->(:AcousticData)
(:Floor)-[:SIGNAL_MAP]->(:SignalHeatmap)
```

## Data Flow (Design E 3-Tier)

- **T1 Social**: スキャン結果共有 (`AppBskyFeedPost` with 3D preview image)
- **T2 Domain**: 点群/メッシュ/構造データ (`ComAtprotoRepoCreateRecord`)
- **T3 State**: スキャンセッション進行状態 (`Preferences`)

## Key Algorithms

### PointCloud (sense-pointcloud)
- **SfM** (Structure from Motion): 複数カメラ画像から 3D 点群復元。特徴点抽出 (ORB) → マッチング → Bundle Adjustment
- **Depth Fusion**: LiDAR/ToF depth map を累積して dense point cloud 生成
- **Octree**: 点群の空間インデックス (LOD, 近傍探索)

### Mesh (sense-mesh)
- **TSDF** (Truncated Signed Distance Function): 点群 → volumetric representation
- **Marching Cubes**: TSDF → triangle mesh (isosurface extraction)
- **Poisson Surface Reconstruction**: 法線付き点群 → watertight mesh
- **Mesh Simplification**: Quadric error metrics で LOD 生成

### Acoustic (sense-acoustic)
- **FFT**: マイク入力の周波数解析
- **Impulse Response**: チャープ/クラップ → 室内残響特性
- **Room Dimension Estimation**: 反射パターンから寸法推定 (Image Source Method)
- **Material Classification**: 吸音率から壁面材質推定

### Signal (sense-signal)
- **RSSI Trilateration**: 3+ AP の信号強度 → 3D 位置推定
- **Fingerprinting**: 電波地図と照合して位置特定
- **Particle Filter**: 移動軌跡の逐次推定
- **Wall Attenuation Model**: 信号減衰から壁の存在・材質推定

### Fusion (sense-fusion)
- **Extended Kalman Filter**: 異種センサーの統合推定
- **Occupancy Grid**: 3D ボクセル空間の占有確率マップ
- **TSDF Volume Integration**: 全センサーからの距離情報を TSDF に統合
- **Structural Segmentation**: RANSAC + region growing で壁/柱/梁を分離

## WASM Build

```bash
# 各 component
cd wasm/etzhayyim-wasm-sense-{name}-{nanoid}
cargo component build --release --target wasm32-wasi
# sccache 禁止 (zigbuild 不要、wasm32-wasi target)
```

## Prohibited Patterns

- Canvas 2D 禁止 (KAMI wgpu のみ)
- JS での点群/メッシュ計算禁止 (全て Rust WASM)
- 生の ArrayBuffer 転送禁止 (Arrow IPC or CBOR)
- base64 エンコード禁止 (binary 直接転送)
- polling ベースのスキャン禁止 (wRPC reactive stream)
