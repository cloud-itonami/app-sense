import {
  asAgentTool,
  createWorkerExport,
  nowISO,
  withCapabilityTags,
  type HostSDK,
  parseYataRows, decodeJson,
  nsid,
  parseLexiconInput,
} from "@etzhayyim/kotodama-host-sdk";

// --- Scan Session ---

async function cmdScanCreate(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const args = parseLexiconInput("com.etzhayyim.apps.sense.scan.create", body);
  const { sensorTypes, buildingName, location } = args;
  const sessionId = crypto.randomUUID();
  const now = nowISO();

  await sdk.pds.comAtprotoRepoCreateRecord("scan", {
    sessionId,
    sensorTypes,
    buildingName,
    location,
    status: "active",
    frameCount: 0,
    createdAt: now,
  });

  for (const sensor of (sensorTypes ?? [])) {
    await sdk.pds.comAtprotoRepoCreateRecord("sensor", {
      sessionId,
      sensorType: sensor,
      status: "pendingCalibration",
      createdAt: now,
    });
  }

  return { sessionId, status: "active" };
}

async function cmdScanUpdate(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { sessionId, frame } = parseLexiconInput("com.etzhayyim.apps.sense.scan.update", body);

  await sdk.pds.comAtprotoRepoCreateRecord("scan", {
    sessionId,
    sensorType: frame?.sensorType,
    dataCid: frame?.dataCid,
    pose: frame?.pose,
    timestamp: frame?.timestamp,
  });

  return { accepted: true };
}

async function cmdScanComplete(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { sessionId } = parseLexiconInput("com.etzhayyim.apps.sense.scan.complete", body);
  return { sessionId, status: "processing" };
}

async function cmdScanGet(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { sessionId } = parseLexiconInput("com.etzhayyim.apps.sense.scan.get", body);
  const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
  const parsed = parseYataRows(rows);
  return parsed[0] ?? null;
}

async function cmdScanList(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const args = parseLexiconInput("com.etzhayyim.apps.sense.scan.list", body);
  const limit = Math.min(Number(args.limit) || 20, 200);
  const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
  return { sessions: parseYataRows(rows) };
}

// --- Building Model ---

async function cmdBuildingCreate(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { sessionId, name, meshCid, metadata } = parseLexiconInput("com.etzhayyim.apps.sense.building.create", body);
  const now = nowISO();

  await sdk.pds.comAtprotoRepoCreateRecord("building", {
    sessionId,
    name,
    meshCid,
    metadata,
    createdAt: now,
  });

  await sdk.pds.comAtprotoIdentityCreate(`building:${sessionId}`, {
    displayName: name,
    description: `3D model reconstructed from sensor scan ${sessionId}`,
  });

  return { buildingDid: `did:web:sense.etzhayyim.com:building:${sessionId}` };
}

async function cmdBuildingGet(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { buildingId } = parseLexiconInput("com.etzhayyim.apps.sense.building.get", body);
  const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
  const parsed = parseYataRows(rows);
  return parsed[0] ?? null;
}

async function cmdBuildingList(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const args = parseLexiconInput("com.etzhayyim.apps.sense.building.list", body);
  const limit = Math.min(Number(args.limit) || 20, 200);
  const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
  return { buildings: parseYataRows(rows) };
}

async function cmdBuildingExport(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { buildingId, format } = parseLexiconInput("com.etzhayyim.apps.sense.building.export", body);
  const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
  const parsed = parseYataRows(rows);
  if (!parsed[0]) return { error: "buildingNotFound" };
  return { meshCid: parsed[0].cid, format, vertices: parsed[0].vertices, faces: parsed[0].faces };
}

// --- Floor & Room ---

async function cmdFloorCreate(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { buildingId, floorNumber, boundary, height } = parseLexiconInput("com.etzhayyim.apps.sense.floor.create", body);

  await sdk.pds.comAtprotoRepoCreateRecord("floor", {
    buildingId,
    floorNumber,
    boundary,
    height,
    createdAt: nowISO(),
  });

  await sdk.pds.comAtprotoIdentityCreate(`floor:${buildingId}:${floorNumber}`, {
    displayName: `Floor ${floorNumber}`,
    description: `Floor plan for building ${buildingId}`,
  });

  return { floorId: `${buildingId}:${floorNumber}` };
}

async function cmdFloorGet(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { buildingId, floorNumber } = parseLexiconInput("com.etzhayyim.apps.sense.floor.get", body);
  const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
  const parsed = parseYataRows(rows);
  return parsed[0] ?? null;
}

async function cmdRoomCreate(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { floorId, name, boundary, acousticProfile, material } = parseLexiconInput("com.etzhayyim.apps.sense.room.create", body);

  await sdk.pds.comAtprotoRepoCreateRecord("room", {
    floorId,
    name,
    boundary,
    acousticProfile,
    material,
    createdAt: nowISO(),
  });

  return { roomId: `${floorId}:${name}` };
}

async function cmdRoomGet(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { roomId } = parseLexiconInput("com.etzhayyim.apps.sense.room.get", body);
  const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
  const parsed = parseYataRows(rows);
  return parsed[0] ?? null;
}

// --- Structure Analysis ---

async function cmdStructureDetect(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { buildingId, meshCid } = parseLexiconInput("com.etzhayyim.apps.sense.structure.detect", body);
  return { buildingId, meshCid, status: "detectionQueued" };
}

async function cmdStructureGet(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { structureId } = parseLexiconInput("com.etzhayyim.apps.sense.structure.get", body);
  const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
  const parsed = parseYataRows(rows);
  return parsed[0] ?? null;
}

async function cmdStructureList(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const args = parseLexiconInput("com.etzhayyim.apps.sense.structure.list", body);
  const { buildingId, kind } = args;
  const limit = Math.min(Number(args.limit) || 50, 200);

  const kindClause = kind ? " AND s.kind = $kind" : "";
  const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
  return { structures: parseYataRows(rows) };
}

async function cmdStructureCrossSection(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { buildingId, plane } = parseLexiconInput("com.etzhayyim.apps.sense.structure.crossSection", body);
  return { buildingId, plane, status: "crossSectionQueued" };
}

// --- Sensor Device ---

async function cmdSensorRegister(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { deviceType, deviceId, capabilities } = parseLexiconInput("com.etzhayyim.apps.sense.sensor.register", body);

  await sdk.pds.comAtprotoRepoCreateRecord("sensor", {
    deviceType,
    deviceId,
    capabilities,
    status: "registered",
    createdAt: nowISO(),
  });

  await sdk.pds.comAtprotoIdentityCreate(`sensor:${deviceId}`, {
    displayName: `${deviceType} sensor ${deviceId}`,
    description: `Registered ${deviceType} sensor device`,
  });

  return { sensorDid: `did:web:sense.etzhayyim.com:sensor:${deviceId}` };
}

async function cmdSensorCalibrate(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { deviceId, calibrationData } = parseLexiconInput("com.etzhayyim.apps.sense.sensor.calibrate", body);

  await sdk.pds.comAtprotoRepoCreateRecord("sensor", {
    deviceId,
    calibrationData,
    calibratedAt: nowISO(),
  });

  return { calibrated: true };
}

async function cmdSensorStatus(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { deviceId } = parseLexiconInput("com.etzhayyim.apps.sense.sensor.status", body);
  const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
  const parsed = parseYataRows(rows);
  return parsed[0] ?? null;
}

// --- Visualization ---

async function cmdVizRender(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { buildingId, cameraPose, options } = parseLexiconInput("com.etzhayyim.apps.sense.viz.render", body);

  const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
  const parsed = parseYataRows(rows);
  if (!parsed[0]) return { error: "buildingNotFound" };

  return { meshCid: parsed[0].meshCid, cameraPose, renderOptions: options };
}

async function cmdVizHeatmap(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { buildingId, floorNumber, heatmapType } = parseLexiconInput("com.etzhayyim.apps.sense.viz.heatmap", body);
  return { buildingId, floorNumber, heatmapType, status: "heatmapQueued" };
}

async function cmdVizTimeline(sdk: HostSDK, body: Uint8Array): Promise<unknown> {
  const { buildingId } = parseLexiconInput("com.etzhayyim.apps.sense.viz.timeline", body);
  const rows = [] as Record<string, unknown>[]; // SQL deprecated 2026-04-12
  return { timeline: parseYataRows(rows) };
}

// --- App registration ---

export default createWorkerExport((sdk) => {
  sdk.app
    // Scan Session
    .command(nsid("com.etzhayyim.apps.sense.scan.create"), (ctx, body) => cmdScanCreate(sdk, body),
      asAgentTool("Create a new sensor scan session"),
      withCapabilityTags("sensor-fusion", "3d-reconstruction"),
    )
    .command(nsid("com.etzhayyim.apps.sense.scan.update"), (ctx, body) => cmdScanUpdate(sdk, body),
      asAgentTool("Add sensor frame to scan session"),
      withCapabilityTags("sensor-fusion"),
    )
    .command(nsid("com.etzhayyim.apps.sense.scan.complete"), (ctx, body) => cmdScanComplete(sdk, body),
      asAgentTool("Complete scan and trigger fusion pipeline"),
      withCapabilityTags("sensor-fusion", "3d-reconstruction"),
    )
    .command(nsid("com.etzhayyim.apps.sense.scan.get"), (ctx, body) => cmdScanGet(sdk, body),
      asAgentTool("Get scan session details"),
      withCapabilityTags("domain-query"),
    )
    .command(nsid("com.etzhayyim.apps.sense.scan.list"), (ctx, body) => cmdScanList(sdk, body),
      asAgentTool("List scan sessions"),
      withCapabilityTags("domain-query"),
    )
    // Building Model
    .command(nsid("com.etzhayyim.apps.sense.building.create"), (ctx, body) => cmdBuildingCreate(sdk, body),
      asAgentTool("Create 3D building model from scan"),
      withCapabilityTags("3d-reconstruction", "data-management"),
    )
    .command(nsid("com.etzhayyim.apps.sense.building.get"), (ctx, body) => cmdBuildingGet(sdk, body),
      asAgentTool("Get building 3D model"),
      withCapabilityTags("domain-query"),
    )
    .command(nsid("com.etzhayyim.apps.sense.building.list"), (ctx, body) => cmdBuildingList(sdk, body),
      asAgentTool("List buildings"),
      withCapabilityTags("domain-query"),
    )
    .command(nsid("com.etzhayyim.apps.sense.building.export"), (ctx, body) => cmdBuildingExport(sdk, body),
      asAgentTool("Export building model as glTF/PLY/OBJ"),
      withCapabilityTags("3d-reconstruction"),
    )
    // Floor & Room
    .command(nsid("com.etzhayyim.apps.sense.floor.create"), (ctx, body) => cmdFloorCreate(sdk, body),
      asAgentTool("Create floor plan"),
      withCapabilityTags("3d-reconstruction", "data-management"),
    )
    .command(nsid("com.etzhayyim.apps.sense.floor.get"), (ctx, body) => cmdFloorGet(sdk, body),
      asAgentTool("Get floor plan"),
      withCapabilityTags("domain-query"),
    )
    .command(nsid("com.etzhayyim.apps.sense.room.create"), (ctx, body) => cmdRoomCreate(sdk, body),
      asAgentTool("Create room data with acoustic profile"),
      withCapabilityTags("sensor-fusion", "data-management"),
    )
    .command(nsid("com.etzhayyim.apps.sense.room.get"), (ctx, body) => cmdRoomGet(sdk, body),
      asAgentTool("Get room data including structures and acoustics"),
      withCapabilityTags("domain-query"),
    )
    // Structure Analysis
    .command(nsid("com.etzhayyim.apps.sense.structure.detect"), (ctx, body) => cmdStructureDetect(sdk, body),
      asAgentTool("Detect structures (wall/column/beam/pipe/wiring)"),
      withCapabilityTags("3d-reconstruction", "sensor-fusion"),
    )
    .command(nsid("com.etzhayyim.apps.sense.structure.get"), (ctx, body) => cmdStructureGet(sdk, body),
      asAgentTool("Get structure details"),
      withCapabilityTags("domain-query"),
    )
    .command(nsid("com.etzhayyim.apps.sense.structure.list"), (ctx, body) => cmdStructureList(sdk, body),
      asAgentTool("List structures in building"),
      withCapabilityTags("domain-query"),
    )
    .command(nsid("com.etzhayyim.apps.sense.structure.crossSection"), (ctx, body) => cmdStructureCrossSection(sdk, body),
      asAgentTool("Generate cross-section view"),
      withCapabilityTags("3d-reconstruction"),
    )
    // Sensor Device
    .command(nsid("com.etzhayyim.apps.sense.sensor.register"), (ctx, body) => cmdSensorRegister(sdk, body),
      asAgentTool("Register sensor device"),
      withCapabilityTags("sensor-fusion", "data-management"),
    )
    .command(nsid("com.etzhayyim.apps.sense.sensor.calibrate"), (ctx, body) => cmdSensorCalibrate(sdk, body),
      asAgentTool("Calibrate sensor device"),
      withCapabilityTags("sensor-fusion"),
    )
    .command(nsid("com.etzhayyim.apps.sense.sensor.status"), (ctx, body) => cmdSensorStatus(sdk, body),
      asAgentTool("Get sensor device status"),
      withCapabilityTags("domain-query"),
    )
    // Visualization
    .command(nsid("com.etzhayyim.apps.sense.viz.render"), (ctx, body) => cmdVizRender(sdk, body),
      asAgentTool("Request 3D render of building"),
      withCapabilityTags("3d-reconstruction"),
    )
    .command(nsid("com.etzhayyim.apps.sense.viz.heatmap"), (ctx, body) => cmdVizHeatmap(sdk, body),
      asAgentTool("Generate WiFi/BT/acoustic heatmap"),
      withCapabilityTags("sensor-fusion"),
    )
    .command(nsid("com.etzhayyim.apps.sense.viz.timeline"), (ctx, body) => cmdVizTimeline(sdk, body),
      asAgentTool("Get scan timeline for building"),
      withCapabilityTags("domain-query"),
    );
});
