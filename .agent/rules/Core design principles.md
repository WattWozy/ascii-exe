# 1. CPU-Efficient Game Loop

### **Goal: one game loop can handle MANY rooms**

**Key rules:**

* Use **one global tick** (e.g. 20–30Hz) and update all rooms in that loop → *don’t run separate timers per room*.
* Use **fixed time steps**, not variable or `setTimeout` spam.
* Avoid per-room intervals → these are expensive in Node.

**Pattern:**

```js
setInterval(globalTick, 50); // 20 ticks/sec
function globalTick() {
  for (const room of rooms) room.update();
}
```

---

# 2. Batch All Updates

### **Goal: fewer syscalls, fewer messages**

* Combine all outgoing updates per tick into **one broadcast per player**.
* Avoid sending multiple small messages → batch into one payload.
* Compress server→client traffic (JSON → compressed binary or packed strings).

---

# 3. Keep Rooms Lightweight (Memory)

### **Goal: fit thousands of rooms in RAM**

* Use **arrays** instead of objects when possible.
* Store state as **flat, numeric-friendly structures** (avoid deep objects).
* Reuse arrays / buffers → avoid GC churn.
* Avoid closures inside game loop.
* Minimize string allocations.

---

# 4. Avoid Per-Room Processes or Containers

### **Goal: many rooms share one Node process**

**NEVER:**

* one Node process per room
* one container per room
* one VM per room

**YES:**

* one Node process handles **hundreds/thousands of rooms**
* if needed, multiple processes via Node Cluster or PM2

---

# 5. Avoid Heavy Serialization (JSON)

### **Goal: cut CPU cost by ~80%**

* Use **binary** or **compact string encoding** instead of JSON.
* JSON parse/stringify is very expensive for 40k rooms.

Examples:

* CSV-like compact strings (`"p:3,4; e:2,1"`)
* Typed arrays
* Small binary buffers

---

# 6. Minimize Network Traffic

### **Goal: reduce bandwidth + CPU per tick**

* Throttle updates (don’t send unchanged data).
* Send only deltas, not full state.
* Compress (gzip or per-message compression).
* Use WebSockets to avoid HTTP overhead.

---

# 7. Avoid Hot GC Spots

### **Goal: no GC spikes → stable tick timing**

* Preallocate buffers.
* Reuse objects (object pools).
* Avoid creating arrays inside the tick loop.
* Keep a stable memory footprint to avoid frequent GC.

---

# 8. Spatial Partitioning (If needed)

### **Goal: fewer computations per tick**

If rooms are 20×20 ASCII, this might be simple anyway.
But if needed:

* Use grids / buckets so you only process local entities.
* Don’t iterate all entities for every entity.

---

# 9. Tick-Time Budget Monitoring

### **Goal: detect when a machine is over capacity**

* Measure tick duration (`performance.now()`).
* If average tick > X ms → reduce rooms on this process or scale up.
* Auto-move rooms if CPU grows too high.

This is core to proper packing.

---

# 10. Use Node's Strengths (but respect its limits)

### **Goal: avoid blocking event loop**

* Avoid crypto in the main thread.
* Avoid reading/writing files synchronously.
* Avoid heavy JSON ops (again).
* Use worker threads only for expensive single tasks, *not per-room*.