import express from "express";
import cors from "cors";
import raidhelperRouter from "./api/raidhelper.js";
import smartishImportRouter from "./api/smartishImport.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("RaidHelper Server Running");
});

app.use("/api/raidhelper", raidhelperRouter);
app.use("/api/smartish-import", smartishImportRouter);

export default app;
