# Known Limitations

- `localSim` 的 E_STOP + RESET 未与后端对齐：后端拒绝并要求先释放，`localSim` 仍允许 RESET 解锁。文案已统一，状态机逻辑未统一。
