/**
 * 创建进程内共享信号量，用于限制数据库/外部服务密集型任务的并发数。
 */
const createSemaphore = (rawLimit) => {
    const limit = Math.max(1, Number(rawLimit) || 1);
    let active = 0;
    const waiters = [];

    const acquire = async () => {
        if (active < limit) {
            active += 1;
            return;
        }
        await new Promise((resolve) => waiters.push(resolve));
    };

    const release = () => {
        const next = waiters.shift();
        if (next) {
            // 将当前槽位直接移交给队首等待者，active 保持不变。
            next();
            return;
        }
        active = Math.max(0, active - 1);
    };

    const run = async (task) => {
        await acquire();
        try {
            return await task();
        } finally {
            release();
        }
    };

    return { run };
};

module.exports = { createSemaphore };
