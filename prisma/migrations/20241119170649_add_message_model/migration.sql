/*
  Warnings:

  - You are about to drop the column `assistantResponse` on the `Thread` table. All the data in the column will be lost.
  - You are about to drop the column `userMessage` on the `Thread` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Thread` DROP COLUMN `assistantResponse`,
    DROP COLUMN `userMessage`;

-- CreateTable
CREATE TABLE `Message` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `content` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `threadId` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Message` ADD CONSTRAINT `Message_threadId_fkey` FOREIGN KEY (`threadId`) REFERENCES `Thread`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
