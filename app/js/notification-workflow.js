export function orderNotificationsForUser(notifications, userId) {
  return (notifications || [])
    .filter((notification) => notification.userId === userId)
    .sort((a, b) => Number(b.createdAt ?? b.created_at) - Number(a.createdAt ?? a.created_at));
}

export function normalizeLocalNotification(notification) {
  const created = new Date(notification?.createdAt);
  const createdAt = Number.isNaN(created.getTime()) ? null : created.toISOString();
  return {
    ...notification,
    body: notification?.body ?? notification?.message ?? "",
    read_at: notification?.read ? (createdAt || new Date(0).toISOString()) : null,
    destination: notification?.link ?? notification?.destination ?? null,
    created_at: createdAt,
  };
}
