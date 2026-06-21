import express from "express";
const router = express.Router();

import { upsertRaidHelperEvent, getRaidHelperEvents } from "../db/raidhelper.js";

router.get("/events",  async (req, res, next) => {
  try {
    const response = await fetch(
      `https://raid-helper.xyz/api/v4/users/${process.env.RAID_HELPER_API_KEY}/events`
    );

    const events = await response.json();
    res.send(events);
  } catch (err) {
    next(err);
  }
});

router.post("/import",  async (req, res, next) => {
  try {
    const raids = req.body;

    const importedRaids = [];
    let insertedCount = 0;
    let updatedCount = 0;

    for (const raid of raids) {
      const importedRaid = await upsertRaidHelperEvent(raid);
      importedRaids.push(importedRaid);

      if (importedRaid.wasInserted) {
        insertedCount += 1;
      } else {
        updatedCount += 1;
      }
    }

    res.send({
      message: "Raid import saved",
      count: importedRaids.length,
      inserted: insertedCount,
      updated: updatedCount,
      raids: importedRaids,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/imported",  async (req, res, next) => {
  try {
    const raids = await getRaidHelperEvents();
    console.log("Raids found:", raids.length);
    res.send(raids);
  } catch (err) {
    next(err);
  }
});




export default router;
