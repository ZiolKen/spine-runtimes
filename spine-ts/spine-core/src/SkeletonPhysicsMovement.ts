/******************************************************************************
 * Spine Runtimes License Agreement
 * Last updated April 5, 2025. Replaces all prior versions.
 *
 * Copyright (c) 2013-2025, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software
 * or otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THE SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

import type { Bone } from "./Bone.js";
import type { Skeleton } from "./Skeleton.js";

/**
 * A 2D transform for the host runtime game object that displays a skeleton.
 *
 * The translation (`tx`, `ty`) must be in the host runtime's game coordinate space.
 * The `a` and `b` values are used by the default rotation calculation
 * (`atan2(b, a)`). Runtimes that cannot represent their game object rotation this
 * way, for example 3D runtimes, should provide
 * {@link SkeletonPhysicsMovementAdapter.getPhysicsRotation}.
 */
export interface SkeletonPhysicsMovementTransform {
	/** The first column X component of the game object transform. */
	a: number;

	/** The first column Y component of the game object transform. */
	b: number;

	/** The X translation of the game object transform in game coordinates. */
	tx: number;

	/** The Y translation of the game object transform in game coordinates. */
	ty: number;
}

/** Converts points between Spine skeleton coordinates and host runtime game coordinates. */
export interface SkeletonCoordinateConverter {
	/**
	 * Converts `point` in-place from skeleton coordinates to host runtime game coordinates.
	 * @param point The point to convert.
	 */
	skeletonToGame (point: { x: number; y: number }): void;

	/**
	 * Converts `point` in-place from host runtime game coordinates to skeleton coordinates.
	 * @param point The point to convert.
	 */
	gameToSkeleton (point: { x: number; y: number }): void;

	/**
	 * Converts `point` in-place from host runtime game coordinates to the local coordinates of `bone`.
	 * @param point The point to convert.
	 * @param bone The bone whose local coordinates should receive the converted point.
	 */
	gameToBone (point: { x: number; y: number }, bone: Bone): void;
}

/** Object whose game-object movement should be inherited by skeleton physics constraints. */
export interface SkeletonPhysicsMovementTarget extends Pick<SkeletonCoordinateConverter, "gameToSkeleton"> {
	/** The skeleton whose physics constraints receive inherited movement. */
	skeleton: Skeleton;
}

/** Runtime-specific hooks needed by {@link SkeletonPhysicsMovement}. */
export interface SkeletonPhysicsMovementAdapter {
	/**
	 * Returns the current host runtime game object transform.
	 * @returns The current game object transform.
	 */
	getGameObjectTransform (): SkeletonPhysicsMovementTransform;

	/**
	 * Returns the current host runtime game object rotation in degrees, in the direction expected by Spine physics.
	 * If omitted, rotation is calculated as `atan2(transform.b, transform.a) * 180 / PI`.
	 * @param transform The transform returned by {@link getGameObjectTransform} for this update.
	 * @returns The game object rotation in degrees.
	 */
	getPhysicsRotation?(transform: SkeletonPhysicsMovementTransform): number;
}

/**
 * Tracks movement of a host runtime game object and applies that movement to skeleton physics constraints.
 *
 * This is useful for runtimes where a Spine skeleton is displayed by a movable game object/container.
 * When enabled, changes in the game object's position are converted to skeleton coordinates and passed to
 * {@link Skeleton.physicsTranslate}. Changes in game object rotation are passed to {@link Skeleton.physicsRotate}.
 *
 * Movement inheritance is opt-in. Position and rotation inheritance default to `0`, so
 * {@link applyTransformMovement} returns immediately until one of the inheritance values is non-zero.
 */
export class SkeletonPhysicsMovement {
	private positionInheritanceFactorX = 0;
	private positionInheritanceFactorY = 0;
	private rotationInheritanceFactor = 0;
	private hasLastTransform = false;
	private lastX = 0;
	private lastY = 0;
	private lastRotation = 0;
	private readonly currentPosition = { x: 0, y: 0 };
	private readonly lastPosition = { x: 0, y: 0 };
	private getPhysicsRotation = (transform: SkeletonPhysicsMovementTransform): number => Math.atan2(transform.b, transform.a) * 180 / Math.PI;

	/**
	 * Creates a movement tracker for a skeleton displayed by a host runtime game object.
	 * @param target The object containing the skeleton and coordinate conversion used by the tracker.
	 * @param adapter Runtime-specific hooks used to read the game object transform and rotation.
	 */
	constructor (
		private target: SkeletonPhysicsMovementTarget,
		private adapter: SkeletonPhysicsMovementAdapter,
	) {
		if (adapter.getPhysicsRotation) this.getPhysicsRotation = adapter.getPhysicsRotation;
	}

	/** Horizontal position inheritance factor. `0` disables horizontal position inheritance. */
	get positionInheritanceX (): number {
		return this.positionInheritanceFactorX;
	}

	/** Vertical position inheritance factor. `0` disables vertical position inheritance. */
	get positionInheritanceY (): number {
		return this.positionInheritanceFactorY;
	}

	/**
	 * Sets how much game object translation is inherited by skeleton physics constraints.
	 * Use `(1, 1)` for normal inheritance, or `(0, 0)` to disable position inheritance.
	 * @param x The horizontal position inheritance factor.
	 * @param y The vertical position inheritance factor.
	 */
	setPositionInheritance (x: number, y: number): void {
		const wasDisabled = this.positionInheritanceFactorX === 0 && this.positionInheritanceFactorY === 0;
		const isEnabled = x !== 0 || y !== 0;
		this.positionInheritanceFactorX = x;
		this.positionInheritanceFactorY = y;
		if (wasDisabled && isEnabled) this.resetPosition();
	}

	/** Rotation inheritance factor. `0` disables rotation inheritance. */
	get rotationInheritance (): number {
		return this.rotationInheritanceFactor;
	}

	/**
	 * Sets how much game object rotation is inherited by skeleton physics constraints.
	 * @param value The rotation inheritance factor.
	 */
	set rotationInheritance (value: number) {
		const wasDisabled = this.rotationInheritanceFactor === 0;
		this.rotationInheritanceFactor = value;
		if (wasDisabled && value !== 0) this.resetRotation();
	}

	/** Resets the previous position used to calculate inherited translation. */
	resetPosition (): void {
		const transform = this.adapter.getGameObjectTransform();
		this.lastX = transform.tx;
		this.lastY = transform.ty;
		if (!this.hasLastTransform) this.lastRotation = this.getPhysicsRotation(transform);
		this.hasLastTransform = true;
	}

	/** Resets the previous rotation used to calculate inherited rotation. */
	resetRotation (): void {
		const transform = this.adapter.getGameObjectTransform();
		this.lastRotation = this.getPhysicsRotation(transform);
		if (!this.hasLastTransform) {
			this.lastX = transform.tx;
			this.lastY = transform.ty;
		}
		this.hasLastTransform = true;
	}

	/** Resets both previous position and previous rotation. */
	resetTransform (): void {
		this.resetPosition();
		this.resetRotation();
	}

	/**
	 * Applies game object transform movement since the previous call to the skeleton's physics constraints.
	 *
	 * The first call records the current transform as the baseline and does not apply movement.
	 */
	applyTransformMovement (): void {
		const inheritPosition = this.positionInheritanceFactorX !== 0 || this.positionInheritanceFactorY !== 0;
		const inheritRotation = this.rotationInheritanceFactor !== 0;
		if (!inheritPosition && !inheritRotation) return;

		const transform = this.adapter.getGameObjectTransform();
		const { tx, ty } = transform;
		const currentRotation = inheritRotation ? this.getPhysicsRotation(transform) : this.lastRotation;

		if (this.hasLastTransform) {
			if (tx === this.lastX && ty === this.lastY && currentRotation === this.lastRotation) return;
			if (inheritPosition && (tx !== this.lastX || ty !== this.lastY)) this.applyPositionMovement(tx, ty);
			if (inheritRotation && currentRotation !== this.lastRotation) this.applyRotationMovement(currentRotation);
		}

		this.setLastTransform(tx, ty, currentRotation);
	}

	private applyPositionMovement (currentX: number, currentY: number): void {
		const currentPosition = this.currentPosition;
		currentPosition.x = currentX;
		currentPosition.y = currentY;
		this.target.gameToSkeleton(currentPosition);

		const lastPosition = this.lastPosition;
		lastPosition.x = this.lastX;
		lastPosition.y = this.lastY;
		this.target.gameToSkeleton(lastPosition);

		this.target.skeleton.physicsTranslate(
			(currentPosition.x - lastPosition.x) * this.positionInheritanceFactorX,
			(currentPosition.y - lastPosition.y) * this.positionInheritanceFactorY
		);
	}

	private applyRotationMovement (currentRotation: number): void {
		const rotationFactor = this.rotationInheritanceFactor;
		if (rotationFactor === 0) return;
		this.target.skeleton.physicsRotate(0, 0, this.getRotationDelta(currentRotation, this.lastRotation) * rotationFactor);
	}

	private setLastTransform (x: number, y: number, rotation: number): void {
		this.lastX = x;
		this.lastY = y;
		this.lastRotation = rotation;
		this.hasLastTransform = true;
	}

	private getRotationDelta (current: number, previous: number): number {
		let delta = current - previous;
		delta = (delta + 180) % 360 - 180;
		return delta < -180 ? delta + 360 : delta;
	}
}
