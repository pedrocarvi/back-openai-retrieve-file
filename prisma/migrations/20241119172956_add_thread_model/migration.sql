/*
  Warnings:

  - You are about to drop the `Message` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `assistantResponse` to the `Thread` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userMessage` to the `Thread` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE `Message` DROP FOREIGN KEY `Message_threadId_fkey`;

-- AlterTable
ALTER TABLE `Thread` ADD COLUMN `assistantResponse` VARCHAR(191) NOT NULL,
    ADD COLUMN `userMessage` VARCHAR(191) NOT NULL;

-- DropTable
DROP TABLE `Message`;
