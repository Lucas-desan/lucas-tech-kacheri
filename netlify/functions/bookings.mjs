import { randomUUID, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }
});

const isValidAdminPin = (suppliedPin) => {
  const expectedPin = process.env.ADMIN_PIN;
  if (!expectedPin || typeof suppliedPin !== 'string') {
    return false;
  }

  const supplied = Buffer.from(suppliedPin);
  const expected = Buffer.from(expectedPin);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
};

const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const validateNewBooking = (value) => {
  const customer = value?.customer;
  const service = value?.service;
  return Boolean(
    customer &&
    typeof customer.name === 'string' &&
    customer.name.trim().length > 0 &&
    customer.name.length <= 160 &&
    typeof customer.phone === 'string' &&
    customer.phone.trim().length > 0 &&
    customer.phone.length <= 40 &&
    (customer.email === undefined || typeof customer.email === 'string') &&
    (customer.email || '').length <= 254 &&
    service &&
    typeof service.name === 'string' &&
    service.name.length <= 160 &&
    typeof service.category === 'string' &&
    service.category.length <= 100 &&
    Number.isFinite(service.price) &&
    typeof value.date === 'string' &&
    typeof value.time === 'string' &&
    typeof value.meetingType === 'string'
  );
};

const listBookings = async (store) => {
  const bookings = [];
  for await (const page of store.list({ prefix: 'booking:', paginate: true })) {
    const pageBookings = await Promise.all(
      page.blobs.map(({ key }) => store.get(key, { type: 'json' }))
    );
    bookings.push(...pageBookings.filter(Boolean));
  }

  return bookings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export default async (request) => {
  try {
    const store = getStore('ltk-bookings');
    const method = request.method.toUpperCase();
    const segments = new URL(request.url).pathname.split('/').filter(Boolean);
    const bookingsSegment = segments.lastIndexOf('bookings');
    const bookingId = bookingsSegment >= 0 ? segments[bookingsSegment + 1] || '' : '';

    if (method === 'POST' && !bookingId) {
      const input = await readJson(request);
      if (!input || !validateNewBooking(input)) {
        return jsonResponse({ error: 'Please provide valid booking details.' }, 400);
      }

      const id = `LTK-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
      const booking = {
        id,
        service: input.service,
        date: input.date,
        time: input.time,
        meetingType: input.meetingType,
        customer: {
          name: input.customer.name.trim(),
          email: (input.customer.email || '').trim(),
          phone: input.customer.phone.trim(),
          location: typeof input.customer.location === 'string' ? input.customer.location.slice(0, 200) : '',
          notes: typeof input.customer.notes === 'string' ? input.customer.notes.slice(0, 2000) : ''
        },
        status: 'Confirmed',
        createdAt: new Date().toISOString()
      };

      await store.setJSON(`booking:${id}`, booking);
      return jsonResponse({ booking }, 201);
    }

    if (!['GET', 'PATCH', 'DELETE'].includes(method)) {
      return jsonResponse({ error: 'Method not allowed.' }, 405);
    }

    if (!process.env.ADMIN_PIN) {
      return jsonResponse({
        error: 'Admin access is not configured. Set ADMIN_PIN in Netlify site environment variables, then redeploy.',
        code: 'ADMIN_PIN_NOT_CONFIGURED'
      }, 503);
    }

    if (!isValidAdminPin(request.headers.get('x-admin-pin'))) {
      return jsonResponse({ error: 'Incorrect admin PIN.' }, 401);
    }

    if (method === 'GET' && !bookingId) {
      return jsonResponse({ bookings: await listBookings(store) });
    }

    if (!bookingId) {
      return jsonResponse({ error: 'A booking ID is required.' }, 400);
    }

    const key = `booking:${bookingId}`;
    const booking = await store.get(key, { type: 'json' });
    if (!booking) {
      return jsonResponse({ error: 'Booking not found.' }, 404);
    }

    if (method === 'PATCH') {
      const input = await readJson(request);
      if (input?.status !== 'Cancelled') {
        return jsonResponse({ error: 'Unsupported booking update.' }, 400);
      }
      const updatedBooking = { ...booking, status: 'Cancelled' };
      await store.setJSON(key, updatedBooking);
      return jsonResponse({ booking: updatedBooking });
    }

    await store.delete(key);
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Booking API request failed', error);
    return jsonResponse({ error: 'The booking service is temporarily unavailable.' }, 500);
  }
};
