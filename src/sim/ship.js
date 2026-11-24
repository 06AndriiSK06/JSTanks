const TWO_PI = Math.PI * 2;

export const TANK_CONFIG = {
	turnSpeed: 3.1,
	forwardAccel: 540,
	reverseAccel: 320,
	drag: 2.4,
	maxSpeed: 340,
	boostImpulse: 220,
	boostDuration: 0.25,
};

export function createShip(x = 400, y = 300) {
	return {
		x,
		y,
		vx: 0,
		vy: 0,
		angle: -Math.PI / 2,
		thrust: 0,
		boostTimer: 0,
	};
}

export function cloneShip(ship) {
	return {
		x: ship.x,
		y: ship.y,
		vx: ship.vx,
		vy: ship.vy,
		angle: ship.angle,
		thrust: ship.thrust,
		boostTimer: ship.boostTimer,
	};
}

export function normalizeAngle(angle) {
	let a = angle % TWO_PI;
	if (a > Math.PI) a -= TWO_PI;
	if (a < -Math.PI) a += TWO_PI;
	return a;
}

export function integrate(ship, input, dt) {
	const turnLeft = input.isDown("KeyA") || input.isDown("ArrowLeft");
	const turnRight = input.isDown("KeyD") || input.isDown("ArrowRight");
	const moveForward = input.isDown("KeyW") || input.isDown("ArrowUp");
	const moveBackward = input.isDown("KeyS") || input.isDown("ArrowDown");

	const turnDir = (turnRight ? 1 : 0) - (turnLeft ? 1 : 0);
	ship.angle = normalizeAngle(
		ship.angle + turnDir * TANK_CONFIG.turnSpeed * dt,
	);

	let thrustInput = 0;
	if (moveForward) thrustInput += 1;
	if (moveBackward) thrustInput -= 1;
	ship.thrust = thrustInput;

	const cos = Math.cos(ship.angle);
	const sin = Math.sin(ship.angle);

	if (thrustInput > 0) {
		ship.vx += cos * TANK_CONFIG.forwardAccel * dt;
		ship.vy += sin * TANK_CONFIG.forwardAccel * dt;
	} else if (thrustInput < 0) {
		ship.vx -= cos * TANK_CONFIG.reverseAccel * dt;
		ship.vy -= sin * TANK_CONFIG.reverseAccel * dt;
	}

	if (input.justPressed("Space")) {
		ship.vx += cos * TANK_CONFIG.boostImpulse;
		ship.vy += sin * TANK_CONFIG.boostImpulse;
		ship.boostTimer = TANK_CONFIG.boostDuration;
	}

	if (ship.boostTimer > 0) {
		ship.boostTimer = Math.max(0, ship.boostTimer - dt);
	}

	const damping = Math.exp(-TANK_CONFIG.drag * dt);
	ship.vx *= damping;
	ship.vy *= damping;

	const currentMaxSpeed =
		ship.boostTimer > 0 ? TANK_CONFIG.maxSpeed * 1.45 : TANK_CONFIG.maxSpeed;
	const speed = Math.hypot(ship.vx, ship.vy);
	if (speed > currentMaxSpeed) {
		const scale = currentMaxSpeed / speed;
		ship.vx *= scale;
		ship.vy *= scale;
	}

	ship.x += ship.vx * dt;
	ship.y += ship.vy * dt;
}
