-- CreateTable
CREATE TABLE "RoomLiveState" (
    "roomId" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomLiveState_pkey" PRIMARY KEY ("roomId")
);

-- AddForeignKey
ALTER TABLE "RoomLiveState" ADD CONSTRAINT "RoomLiveState_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
